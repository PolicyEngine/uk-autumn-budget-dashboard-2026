import { HOUSEHOLD_ABOUT_ID } from "../methodology/anchors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "../PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { mostlyFromSpending } from "./SingleYearResults";
import { chooseOption, optionsLabel } from "../../test/optionsPills";
import { WIZARD_DEFAULTS, resetSavedWizard, spendingAssumed } from "../HouseholdCalculator";
import { clearHouseholdImpactCache, setHouseholdRetryPolicy } from "../../hooks/useHouseholdImpact";
import { clearBasisIncomeCache } from "../../hooks/useBasisIncome";
import { presetRequests, resetPresetResults } from "../../utils/householdPresets";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../../test/householdFixture";
import { POLICIES_FOR_TEST } from "../../test/personalPolicies";
import { APPROVED_COMMIT, approvedDefinition, requestedDefinitions, route, withReportedDefinitions } from "../../test/definitionsFixture";
import { keepSentence } from "../../utils/singleYear";

const HOUSEHOLD_API = "https://api.test/api/household-impact";
// The receipts' model versions, which the household fixture's answer runs:
// Household impact shows nothing when the two differ.
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = HOUSEHOLD_FIXTURE.engine;
const PUBLISHED_ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };
const SUPPORTED_POLICY_IDS = POLICIES_FOR_TEST.filter((policy) => HOUSEHOLD_FIXTURE.included.includes(policy.id)).map((policy) => policy.id);

let household;

// The example cards' own requests (useExampleFigures.js), asked in the
// background whenever the precomputed file doesn't answer the selection:
// told apart by their households, none of them yours
const EXAMPLE_HOUSEHOLDS = new Set(presetRequests([]).map((entry) => JSON.stringify(entry.request.household)));
/** The requests for your household: every one but the example cards'. */
const yours = () => household.filter((body) => !EXAMPLE_HOUSEHOLDS.has(JSON.stringify(body.household)));

/**
 * Answer the household API with `respond(body)`, beside the definitions an
 * API running the approved code reports (or `definitionFor(id)` at each
 * requested commit); any other URL is a 404.
 */
function serve(respond, definitionFor) {
  household = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (route(url) === HOUSEHOLD_API) {
        const body = JSON.parse(init.body);
        household.push(body);
        return withReportedDefinitions(await respond(body, init), url, definitionFor);
      }
      return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    }),
  );
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetSavedWizard();
  clearHouseholdImpactCache();
  // A service that fails is asked again (starting up): milliseconds apart
  // here, not the real 5 s
  setHouseholdRetryPolicy({ delayMs: 1, maxRetryAfterMs: 1, minAttemptMs: 1 });
  clearBasisIncomeCache();
  resetPresetResults();
  window.history.replaceState({}, "", "/?tab=personal");
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
  // Figures at once, not counted up: the count-up is presentation only
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const baseEntry = fixtureJson("manifest.json").measures.alpha;
const testCatalogue = buildMeasureCatalogue({
  manifest: {
    ...fixtureJson("manifest.json"),
    measures: Object.fromEntries(POLICIES_FOR_TEST.map((policy) => [policy.id, {
      ...baseEntry, ...policy, years: [2026, 2027, 2028, 2029, 2030, 2031], unsupported_years: [],
    }])),
    combined: {},
  },
  tablesByKey: Object.fromEntries(POLICIES_FOR_TEST.map((policy) => [policy.id, { engine: PUBLISHED_ENGINE, definition: approvedDefinition(policy.id) }])),
});
function PublishedMeasures({ children }) {
  return <MeasureCatalogueProvider catalogue={testCatalogue}>{children}</MeasureCatalogueProvider>;
}

function renderTab(props = {}) {
  return render(
    <PersonalImpactTab
      selectedPolicies={SUPPORTED_POLICY_IDS}
      policies={POLICIES_FOR_TEST}
      year={2029}
      {...props}
    />,
    { wrapper: PublishedMeasures },
  );
}

/** A household's card in the grid, or its chip once the cards fold into a strip. */
function householdItem(name) {
  const region = screen.getByRole("region", { name: "Choose a household" });
  // A chip's name starts with its short text and ends with the full one
  const chip = typeof name === "string" ? (n) => n === name || n.startsWith(`${name},`) || n.endsWith(`: ${name}`) : name;
  return within(region).queryByRole("button", { name }) ?? within(region).getByRole("option", { name: chip });
}

// Nothing is asked until Calculate: every answer has a default, so one
// press gives the results
const calculateButton = () => screen.getByRole("button", { name: /^Calcul/ });
/** Open the form below the cards ("Your household"), unless it is open. */
function openForm() {
  const yours = householdItem(/^Your household/);
  if (document.getElementById(yours.getAttribute("aria-controls"))?.dataset.open !== "true") fireEvent.click(yours);
}
function toResults() {
  openForm();
  fireEvent.click(calculateButton());
}

// The headline card's label, once a result is shown
const HEADLINE = /^Your change$/;
/** The headline card (there is none before a result). */
const headlineCard = () => document.querySelector(".result-card");
/** The headline figure, once it has counted up. */
const changeValue = () => headlineCard().querySelector(".result-change-value").textContent;

// The waterfall, once the split by policy is in (optionally for one year)
const splitShown = (year) =>
  waitFor(() =>
    expect(
      document.querySelector(`.net-income-waterfall[data-split="ready"]${year ? `[data-year="${year}"]` : ""}`),
    ).not.toBeNull(),
  );

// The headline, beside the form
const results = () => screen.findByRole("region", { name: "Results" });

describe("Household impact's results", () => {
  it("show the household calculation alone: no sub-tabs (an old ?sub= link is ignored), only the household route", async () => {
    window.history.replaceState({}, "", "/?tab=personal&sub=multi");
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    await within(await results()).findByText("+£3,765");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prices/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/lifetime/i)).not.toBeInTheDocument();
    // Besides the examples' precomputed file, the example households'
    // income charts below the calculator, the published household scatter
    // (the result among all households, loaded on demand through its
    // artifact's receipt) and the UK files "Where you sit" reads, only the
    // household route
    const urls = fetch.mock.calls
      .map(([url]) => url)
      .filter(
        (url) =>
          !url.endsWith("/household_presets.json") &&
          !url.endsWith("/income_curve.csv") &&
          !url.endsWith("/household_scatter_binned.csv") &&
          !url.endsWith("/receipt.json") &&
          !url.endsWith("/income_distribution.csv") &&
          !url.endsWith("/winners_losers.csv") &&
          !url.endsWith("/distributional_impact.csv") &&
          !url.endsWith("/income_mobility.csv"),
      );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => route(url) === HOUSEHOLD_API)).toBe(true);
    // Each names every selected measure's approved commit, in id order
    for (const url of urls) {
      expect(requestedDefinitions(url)).toEqual([...SUPPORTED_POLICY_IDS].sort().map((id) => [id, APPROVED_COMMIT]));
    }
  });
});

describe("the household calculation, from the fixture", () => {
  it("asks for the headline first, then the sweep and the split by policy at once, with the wizard's answers", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    await splitShown();
    expect(household.map((body) => body.include)).toEqual([[], ["sweep"], ["by_policy"]]);
    const [first] = household;
    expect(first.year).toBe(2029);
    expect(first.household).toMatchObject({
      // The form's defaults (utils/householdDefaults.js)
      age: 30,
      employment_income: 34200,
      region: "NORTH_WEST",
      tenure: "RENT_PRIVATELY",
      monthly_rent: 975,
      student_loan_plan: "NONE",
      has_partner: false,
      claims_universal_credit: true,
      petrol_spending: 620,
      diesel_spending: 340,
      council_tax_band: "D",
      salary_year: 2026,
      children: [],
    });
    expect(first.household).not.toHaveProperty("children_ages");
  });

  // #170 asked for all three parts at once and raced the headline across
  // both services. Merged with #104, the headline stays Cloud Run's: it is
  // what the detail service's parts are checked against (same build), and
  // a Modal headline would have nothing to be checked against. #253: the
  // detail service's parts are asked for with the headline, not after it,
  // and shown only once the headline has arrived and they match its build.
  it("with a detail URL, asks Cloud Run for the headline and the detail service for the sweep and the split by policy at once", async () => {
    const DETAIL_API = "https://modal.test/api/household-impact";
    const BUILD = "b".repeat(40);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL_API);
    const asked = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (route(url) !== HOUSEHOLD_API && route(url) !== DETAIL_API) {
          return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
        }
        const body = JSON.parse(init.body);
        asked.push([route(url), body.include]);
        // The headline waits: nothing else is asked until it answers
        if (body.include.length === 0) await gate;
        return withReportedDefinitions(json({ ...householdAnswerFor(body), git_sha: BUILD }), url);
      }),
    );
    renderTab();
    toResults();
    // All three asked while the headline is still out
    await waitFor(() => expect(asked).toHaveLength(3));
    expect(asked).toEqual(
      expect.arrayContaining([
        [HOUSEHOLD_API, []],
        [DETAIL_API, ["sweep"]],
        [DETAIL_API, ["by_policy"]],
      ]),
    );
    // Nothing is shown before the headline
    expect(screen.queryByText(HEADLINE)).not.toBeInTheDocument();
    release();
    await splitShown();
    expect(await screen.findByRole("heading", { name: /^Household net income, / })).toBeInTheDocument();
    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    // The early answers were used: nothing asked again
    expect(asked).toHaveLength(3);
  });

  it("with a detail URL, asks Cloud Run for a part the detail service answered early from another build", async () => {
    const DETAIL_API = "https://modal.test/api/household-impact";
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL_API);
    const asked = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (route(url) !== HOUSEHOLD_API && route(url) !== DETAIL_API) {
          return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
        }
        const body = JSON.parse(init.body);
        asked.push([route(url), body.include]);
        const build = route(url) === DETAIL_API ? "d".repeat(40) : "c".repeat(40);
        return withReportedDefinitions(json({ ...householdAnswerFor(body), git_sha: build }), url);
      }),
    );
    renderTab();
    toResults();
    await splitShown();
    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    expect(asked.filter(([url]) => url === HOUSEHOLD_API)).toEqual(
      expect.arrayContaining([
        [HOUSEHOLD_API, []],
        [HOUSEHOLD_API, ["sweep"]],
        [HOUSEHOLD_API, ["by_policy"]],
      ]),
    );
  });

  it("with a detail URL, shows no headline from the detail service when Cloud Run's fails", async () => {
    const DETAIL_API = "https://modal.test/api/household-impact";
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL_API);
    const asked = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (route(url) !== HOUSEHOLD_API && route(url) !== DETAIL_API) {
          return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
        }
        const body = JSON.parse(init.body);
        asked.push([route(url), body.include]);
        return route(url) === HOUSEHOLD_API && body.include.length === 0
          ? json({ detail: "boom" }, 503)
          : withReportedDefinitions(json(householdAnswerFor(body)), url);
      }),
    );
    renderTab();
    toResults();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(HEADLINE)).not.toBeInTheDocument();
    // Cloud Run was asked (the request reached it); the detail service's
    // parts were asked for with the headline, and none is shown
    expect(asked).toContainEqual([HOUSEHOLD_API, []]);
    expect(screen.queryByRole("heading", { name: /^Household net income, / })).not.toBeInTheDocument();
  });

  it("shows the result card and breakdown once only the headline has resolved", async () => {
    // The slower parts never answer: the headline must not wait for them
    serve((body) =>
      body.include.length === 0 ? json(householdAnswerFor(body)) : new Promise(() => {}),
    );
    renderTab();
    toResults();
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    expect(document.querySelector("#household-breakdown")).not.toBeNull();
    // The sweep waits in its own card; the waterfall shows one step for
    // every policy until the split arrives
    await waitFor(() => expect(document.querySelectorAll(".waiting-card")).toHaveLength(1));
    expect(await screen.findAllByText("Usually around 60 seconds")).toHaveLength(1);
    expect(document.querySelector('.net-income-waterfall[data-split="pending"]')).not.toBeNull();
    // Changed answers can be sent without waiting for the slower parts
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "40" } });
    expect(calculateButton()).not.toBeDisabled();
  });

  it("shows the change in one result card: the figure, its share, before and after, and what it is based on", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    const panel = await results();
    await within(panel).findByText("+£3,765");
    const card = headlineCard();
    expect(card).toHaveClass("is-gain");
    // No eyebrow: the tiles lead the card
    expect(card.querySelector(".result-card-label")).toBeNull();
    // Three tiles on top: the change (the year and policies under it), its
    // share, your place
    const tiles = [...card.querySelectorAll(".result-tiles .forecast-tile")];
    expect(tiles.map((tile) => tile.querySelector(".forecast-tile-name").textContent)).toEqual([
      "Your change",
      "Share of your income",
      "Your place (percentile)",
    ]);
    expect(tiles[0]).toHaveTextContent(`In 2029-30, with ${SUPPORTED_POLICY_IDS.length} policies`);
    expect(changeValue()).toBe("+£3,765");
    // All three figures in the tiles' one headline class, the change not
    // in the map's micro .result-value
    expect(tiles.map((tile) => tile.querySelectorAll(".forecast-tile-value").length)).toEqual([1, 1, 1]);
    expect(tiles[0].querySelector(".forecast-tile-value .result-change-value")).toHaveTextContent("+£3,765");
    expect(card.querySelector(".result-value")).toBeNull();
    // The figure once, for copying and screen readers alike
    expect(card.textContent.match(/£3,765/g)).toHaveLength(1);
    expect(tiles[0].querySelector(".forecast-tile-sub")).toHaveTextContent("a year, after the selected policies");
    // Its share, and the waterfall from net income before to after
    expect(tiles[1].querySelector(".forecast-tile-value")).toHaveTextContent("+5.76%");
    const ends = [...card.querySelectorAll(".waterfall-row.is-total")].map((row) => row.textContent);
    expect(ends).toEqual(["Net income before£65,371", "Net income after£69,136"]);
    expect(panel.querySelectorAll(".result-card")).toHaveLength(1);
    // The change is said once: no sentence repeating it
    expect(panel).not.toHaveTextContent("The selected policies would");
    expect(card).not.toHaveTextContent("before and after the selected policies.");
    // Only the essentials show: what it is based on is under "About this
    // result", closed at first
    expect(card.querySelector("dl.result-foot-items")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "About this result" }));
    // What it is based on: a strip, each a label over its value, the note
    // behind an "i"; the rail explanation is in "About these figures"
    const assumptions = panel.querySelector("dl.result-foot-items");
    const box = (label) =>
      [...assumptions.querySelectorAll(".result-foot-item")].find((item) =>
        item.querySelector("dt").textContent.startsWith(label),
      );
    expect(box("Salary in 2029-30").querySelector("dd")).toHaveTextContent("£34,192, partner £12,822");
    expect(within(box("Salary in 2029-30")).getByRole("button", { name: /grown from 2026 with OBR earnings/ })).toBeInTheDocument();
    expect(box("Rent area").querySelector("dd")).toHaveTextContent("Central Greater Manchester");
    // Each detail in a tip, shown on focus or hover
    const tipOf = (label) => {
      const button = within(box(label)).getByRole("button");
      fireEvent.focus(button);
      const id = button.getAttribute("aria-describedby").split(" ").pop();
      const text = document.getElementById(id).textContent;
      fireEvent.blur(button);
      return text;
    };
    expect(tipOf("Rent area")).toBe("region default");
    // A supported selection has nothing left out: an unmodelled measure
    // makes the whole selection unavailable instead (#104)
    expect(assumptions).not.toHaveTextContent("not shown");
    expect(assumptions).not.toHaveTextContent("not modelled");
    expect(panel).not.toHaveTextContent("spreads a national cost");
    expect(panel.textContent.match(/Rent area/g)).toHaveLength(1);
    // The spending the fuel and electricity measures act on (the form's
    // prefilled averages: petrol £620 and diesel £340, electricity £1,040)
    expect(box("Spending a year").querySelector("dd")).toHaveTextContent("fuel £960, electricity £1,040");
    // Not entered by the reader: marked as assumed, with what it does
    expect(box("Spending a year").querySelector("dt")).toHaveTextContent("Spending a year (assumed, ONS average)");
    expect(tipOf("Spending a year")).toBe(
      "Fuel and electricity policies scale with what you spend; change these in More details to match your household.",
    );
    // Whose result it is, in one line under the figure
    // No chip row of household facts: the details are in About this result
    expect(card.querySelector(".result-facts")).toBeNull();
    // No child of 16 or over: no item on who counts as a child
    expect(panel).not.toHaveTextContent("Children 16 to 19");
  });

  it("steps from net income before to after, one step per policy that changes the household", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await splitShown();
    // No separate chart of the same figures: each policy's change is said once
    expect(screen.queryByRole("heading", { name: /Change in net income by policy/ })).toBeNull();
    const bars = [...container.querySelectorAll(".waterfall-row.is-step")];
    expect(bars.map((bar) => bar.dataset.row)).toEqual([
      "two_child_limit",
      "threshold_freeze_extension",
      "salary_sacrifice_cap",
      "fuel_duty_freeze",
    ]);
    // No change is a muted dash
    const parse = (text) => (text === "—" ? 0 : Number(text.replace("−", "-").replace(/[£,+]/g, "")));
    const sum = bars
      .map((bar) => parse(bar.querySelector(".waterfall-value").textContent))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(parse(changeValue()));
    expect(sum).toBe(3765);
    // The measures that leave the household where it was: not under the
    // steps but under "About this result", one bullet each, each full
    // name on hover
    expect(container.querySelector(".net-income-waterfall .waterfall-no-effect")).toBeNull();
    fireEvent.click(within(headlineCard()).getByRole("button", { name: "About this result" }));
    const noEffect = container.querySelector(".result-card-no-effect");
    expect(noEffect).toHaveTextContent(/^No effect on you/);
    const names = [...noEffect.querySelectorAll("li")].map((item) => item.title);
    expect(names).toContain("Dividend tax increase (+2pp)");
    expect(names).not.toContain("Interaction between policies");
    expect(container.querySelector(".no-effect-item")).toBeNull();
  });

  it("breaks net income down as Spring Statement does: market income, taxes, benefits", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    const table = await screen.findByRole("table");
    const rowNames = () =>
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent.replace(/[▸▾]/g, ""));
    const topNames = [...table.querySelectorAll(".programme-row.depth-0 th, .breakdown-net-row th")].map((cell) =>
      cell.textContent.replace(/[▸▾]/g, ""),
    );
    expect(topNames).toEqual(["Market income", "Taxes", "Benefits", "Net income"]);
    // Open at first: the programmes show under their groups
    expect(rowNames()).toContain("Income tax");
    for (const name of ["Before", "After", "Change"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    // Net income: the bold total row, with its change (the rows add up to it)
    const net = within(table).getByRole("row", { name: /Net income/ });
    expect(net).toHaveTextContent("£65,371£69,136+£3,765");

    // Each top row shows its taxes or benefits, open at first
    expect(within(table).getByRole("button", { name: /Taxes/ })).toHaveAttribute("aria-expanded", "true");
    const incomeTax = within(table).getByRole("row", { name: /Income tax/ });
    expect(incomeTax).toHaveTextContent("−£4,164−£4,360−£196");
    expect(within(incomeTax).getByText("−£196")).toHaveClass("is-loss");
    // And a programme to its parts
    fireEvent.click(within(table).getByRole("button", { name: /Income tax/ }));
    expect(within(table).getByText("On earnings")).toBeInTheDocument();

    // The top rows add up to net income, in every column
    // No change is a muted dash
    const parse = (text) => (text === "—" ? 0 : Number(text.replace("−", "-").replace(/[£,+]/g, "")));
    const top = [...table.querySelectorAll(".programme-row.depth-0")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => parse(cell.textContent)),
    );
    const sums = [0, 1, 2].map((col) => top.reduce((acc, row) => acc + row[col], 0));
    expect(sums).toEqual([65371, 69136, 3765]);

    // About this chart: closed under the table, then only how this table's
    // rows are estimated; the calculation's method is in Methodology
    const about = within(table.closest(".single-year-breakdown") ?? document.body)
      .getAllByRole("button", { name: "About this chart" })
      .find((button) => button.closest(`#${HOUSEHOLD_ABOUT_ID}`));
    expect(about).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Elements are before the earnings taper/)).not.toBeInTheDocument();
    fireEvent.click(about);
    expect(about).toHaveAttribute("aria-expanded", "true");
    const panel = about.closest(".disclosure");
    expect(panel).toHaveClass("disclosure-in-card");
    expect(within(panel).getByText("Universal Credit")).toBeInTheDocument();
    expect(within(panel).getByText(/Elements are before the earnings taper/)).toBeInTheDocument();
    // No internal names, and the general method is not repeated here
    expect(panel.textContent).not.toMatch(/[A-Z]+_[A-Z_]+/);
    expect(panel).not.toHaveTextContent("Each bar is one policy on its own");
    expect(within(panel).getByRole("link", { name: /How the household calculation works/ })).toHaveAttribute(
      "href",
      "?tab=methodology#method-household-calc",
    );
  });

  it("shows net income, with a Net income / Change switch, beside the marginal rate in one pair of cards marking you", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: "Household net income, 2029-30" });
    // Always shown, not in an expander
    expect(screen.queryByRole("button", { name: "Marginal tax rate across earnings" })).not.toBeInTheDocument();
    // One pair in the charts grid: net income first, the marginal rate beside it
    const pairs = container.querySelectorAll(".single-year-chart-pair");
    expect(pairs).toHaveLength(1);
    const [pair] = pairs;
    expect(pair).toHaveClass("charts-grid");
    expect(pair.children).toHaveLength(2);
    const [earnings, rate] = pair.children;
    expect(within(earnings).getByRole("heading", { name: "Household net income, 2029-30" })).toBeInTheDocument();
    expect(within(rate).getByRole("heading", { name: "Marginal tax rate across earnings, 2029-30" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Net income change, 2029-30" })).not.toBeInTheDocument();
    // Each card's view is in its Options pill, in the controls row, so the
    // pair's rows line up
    expect(earnings.querySelector(".chart-controls .control-bar-button")).not.toBeNull();
    expect(rate.querySelector(".chart-controls .control-bar-button")).not.toBeNull();
    // After first, as the marginal rate card, marking you
    expect(optionsLabel(earnings)).toBe("After");
    expect(earnings.querySelector(".earnings-you")).toHaveTextContent("You");
    expect(within(earnings).getByText("After the selected policies")).toBeInTheDocument();
    // Change: the gain and loss key, still marking you
    chooseOption(earnings, "Change");
    expect(earnings.querySelector("svg.earnings-svg").dataset.view).toBe("change");
    expect(within(earnings).getByText("Higher net income")).toBeInTheDocument();
    expect(earnings.querySelector(".earnings-you")).toHaveTextContent("You");
    // One sentence: the rate, said once when before and after round the
    // same, then the rate as money
    const sentence = within(rate).getByText(/^At £34,192 your marginal tax rate is 68%/);
    expect(sentence).toHaveTextContent(/68%, so of your next £1,000 of earnings, you keep £324\.$/);
    expect(screen.queryByText(/publication's order/)).not.toBeInTheDocument();
  });

  it("asks nothing before Calculate; a year change before it shows nothing either", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = renderTab();
    // Before Calculate: no results box (the cards say what to do), and no
    // request
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(headlineCard()).toBeNull();
    rerender(
      <PersonalImpactTab selectedPolicies={SUPPORTED_POLICY_IDS} policies={POLICIES_FOR_TEST} year={2030} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household).toEqual([]);
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    toResults();
    await waitFor(() => expect(household.some((body) => body.year === 2030)).toBe(true));
    rerender(<PersonalImpactTab selectedPolicies={[]} policies={POLICIES_FOR_TEST} year={2030} />);
    expect(screen.getByText(/Select at least one policy/)).toBeInTheDocument();
  });
});

describe("Calculate", () => {
  it("asks at once for an example card, with no Calculate; an edit waits for Calculate or Enter", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    // An example card shows its result without Calculate, and hides it
    fireEvent.click(householdItem(/(^|: )A graduate on £35,000/));
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    expect(household[0].household.age).toBe(27);
    // Your household opens the form with its answers, and Calculate, to
    // change one and calculate again; the example's result goes
    fireEvent.click(householdItem(/^Your household/));
    expect(headlineCard()).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Age" })).toHaveValue(27);
    expect(calculateButton()).toBeEnabled();
    // An edit brings Calculate back, and asks nothing on its own
    const before = household.length;
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "40" } });
    expect(calculateButton()).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household).toHaveLength(before);
    // Enter in a box sends the form
    fireEvent.submit(screen.getByRole("spinbutton", { name: "Age" }).closest("form"));
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    expect(household[before].household.age).toBe(40);
    // An edit after a result: the result goes, with no box in its place,
    // and nothing is asked
    const asked = household.length;
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "41" } });
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(headlineCard()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household).toHaveLength(asked);
  });
});

describe("an example card", () => {
  // The file's default is reduced motion: these tests choose
  const motion = (reduce) =>
    vi.stubGlobal("matchMedia", (query) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
  it("closes the form, scrolls its result into view below the bars and moves focus to it", async () => {
    serve((body) => json(householdAnswerFor(body)));
    motion(false);
    // jsdom has no scrolling: the page's scroll (utils/pageScroll) is window.scrollTo
    const scrollIntoView = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollIntoView;
    const smooth = () => scrollIntoView.mock.calls.filter(([options]) => options.behavior === "smooth");
    // The result appears below the screen's foot
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 1500, bottom: 1900, height: 400 });
    renderTab();
    openForm();
    fireEvent.click(householdItem(/(^|: )A pensioner with a small private pension/));
    expect(document.querySelector(".household-form-panel")?.dataset.open).not.toBe("true");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0][0]).toEqual({ top: 1500 - 16, behavior: "smooth" });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Results" }));
    // Every card: another one scrolls again
    scrollIntoView.mockClear();
    fireEvent.click(householdItem(/(^|: )A graduate on £35,000/));
    // (the first scroll's own settling re-check is instant, so only smooth ones count)
    await waitFor(() => expect(smooth()).toHaveLength(1));
    expect(smooth()[0][0]).toEqual({ top: 1500 - 16, behavior: "smooth" });
    window.scrollTo = originalScrollTo;
    rect.mockRestore();
  });

  it("asks the scroll again while the page grows under the result, so it is not cut short", async () => {
    serve((body) => json(householdAnswerFor(body)));
    motion(false);
    // jsdom has no scrolling: the page's scroll (utils/pageScroll) is window.scrollTo
    const scrollIntoView = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollIntoView;
    const smooth = () => scrollIntoView.mock.calls.filter(([options]) => options.behavior === "smooth");
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 1500, bottom: 1900, height: 400 });
    // The page's height grows after the first scroll is asked
    let height = 2000;
    const scrollHeight = vi
      .spyOn(document.documentElement, "scrollHeight", "get")
      .mockImplementation(() => height);
    renderTab();
    fireEvent.click(householdItem(/(^|: )A pensioner with a small private pension/));
    await waitFor(() => expect(smooth()).toHaveLength(1));
    height = 3200;
    await waitFor(() => expect(smooth()).toHaveLength(2));
    expect(smooth()[1][0]).toEqual({ top: 1500 - 16, behavior: "smooth" });
    window.scrollTo = originalScrollTo;
    rect.mockRestore();
    scrollHeight.mockRestore();
  });

  it("does not scroll when the result already starts in the top third of the screen, and is instant with reduced motion", async () => {
    serve((body) => json(householdAnswerFor(body)));
    // jsdom has no scrolling: the page's scroll (utils/pageScroll) is window.scrollTo
    const scrollIntoView = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollIntoView;
    const smooth = () => scrollIntoView.mock.calls.filter(([options]) => options.behavior === "smooth");
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 140, bottom: 540, height: 400 });
    renderTab();
    fireEvent.click(householdItem(/(^|: )A pensioner with a small private pension/));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "Results" })));
    expect(scrollIntoView).not.toHaveBeenCalled();
    // Lower down, with reduced motion: an instant scroll
    rect.mockReturnValue({ top: 1500, bottom: 1900, height: 400 });
    motion(true);
    fireEvent.click(householdItem(/(^|: )A graduate on £35,000/));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0][0]).toEqual({ top: 1500 - 16, behavior: "auto" });
    window.scrollTo = originalScrollTo;
    rect.mockRestore();
  });
});

describe("switching from one household's card to another", () => {
  /** The fixture's answer, with a change in net income of `change`. */
  const answerWith = (body, change) => {
    const answer = householdAnswerFor(body);
    const before = answer.net_income.baseline;
    return { ...answer, net_income: { ...answer.net_income, reform: before + change, change } };
  };
  /** Requests held until released by hand: [{ body, release }]. */
  function serveHeld() {
    const held = [];
    household = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url, init = {}) => {
        if (route(url) !== HOUSEHOLD_API) return Promise.resolve(new Response("{}", { status: 404 }));
        const body = JSON.parse(init.body);
        household.push(body);
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          held.push({ body, release: (change) => resolve(withReportedDefinitions(json(answerWith(body, change)), url)) });
        });
      }),
    );
    return held;
  }
  const card = (name) => householdItem(new RegExp(`(^|: )${name}`));

  it("clears the previous card's result at once, shows the new one when it arrives, and ignores a late answer for the previous card", async () => {
    const held = serveHeld();
    renderTab();
    // Example A: its headline arrives; its split by policy and sweep are
    // still out when the reader moves on
    fireEvent.click(card("A graduate on £35,000"));
    await waitFor(() => expect(held).toHaveLength(1));
    held[0].release(1111);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£1,111"));
    await waitFor(() => expect(held).toHaveLength(3));
    // Example B: A's result goes at once; a loading state, not A's figures
    fireEvent.click(card("A pensioner with a small private pension"));
    expect(headlineCard()).toBeNull();
    expect(screen.queryByText("+£1,111")).toBeNull();
    // A's late answers (its split by policy and sweep) change nothing
    held[1].release(1111);
    held[2].release(1111);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(headlineCard()).toBeNull();
    // B's answer arrives: B's figure
    await waitFor(() => expect(held.some(({ body }) => body.household.age === 70)).toBe(true));
    held.find(({ body }) => body.household.age === 70 && body.include.length === 0).release(2222);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£2,222"));
    expect(screen.queryByText("+£1,111")).toBeNull();
  });

  it("from an example to Your household: the form opens with the example's answers, the example's result goes, Calculate gives Your household's own", async () => {
    serve((body) => json(answerWith(body, body.household.age === 27 ? 1111 : 3333)));
    renderTab();
    fireEvent.click(card("A graduate on £35,000"));
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£1,111"));
    fireEvent.click(card("Your household"));
    expect(screen.getByRole("spinbutton", { name: "Age" })).toHaveValue(27);
    expect(headlineCard()).toBeNull();
    expect(screen.queryByText("+£1,111", { selector: ".result-change-value" })).toBeNull();
    // A changed answer and Calculate: the new result
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "41" } });
    fireEvent.click(calculateButton());
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£3,333"));
    // Your household's own figure, on its chip, chosen with its tick
    const yours = card("Your household");
    expect(yours).toHaveAttribute("aria-selected", "true");
    expect(yours).toHaveTextContent("+£3,333");
  });
});

describe("the examples' precomputed results", () => {
  /** Choose an example with the file recording `fileDefinitions`, and wait for its whole result. */
  async function chooseExample(fileDefinitions) {
    // The file as the precompute writes it: the API's answer for each
    // example's own request (here the fixture's answer)
    // #185 on #104: the file names its own measures; here every measure
    // the page is given, so the cards' figures and answers apply
    // the household API models (an unmodelled one makes the selection
    // unavailable, #104)
    const PRESET_POLICIES = SUPPORTED_POLICY_IDS;
    const presetMeasures = POLICIES_FOR_TEST.filter((policy) => PRESET_POLICIES.includes(policy.id));
    const entries = presetRequests(PRESET_POLICIES).map(({ preset_id, year, request }) => ({
      preset_id,
      year,
      request,
      response: householdAnswerFor(request),
    }));
    household = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (url.endsWith("/data/household_presets.json")) return json({ policies: PRESET_POLICIES, engine: PUBLISHED_ENGINE, definitions: fileDefinitions, entries });
        household.push(JSON.parse(init.body));
        return withReportedDefinitions(json(householdAnswerFor(JSON.parse(init.body))), url);
      }),
    );
    render(
      <PersonalImpactTab selectedPolicies={PRESET_POLICIES} policies={presetMeasures} year={2029} />,
      { wrapper: PublishedMeasures },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(householdItem(/(^|: )A graduate on £35,000/));
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    await splitShown();
  }

  it("show an example's result from the published file, with no request to the API", async () => {
    // The file records each measure's approved definition, as the
    // precompute does (#136)
    await chooseExample(Object.fromEntries(SUPPORTED_POLICY_IDS.map((id) => [id, approvedDefinition(id)])));
    expect(household).toEqual([]);
  });

  // #136: the file's answers are checked as a live answer is. One that
  // reports no definitions (written before them), or another for any
  // measure, is never shown: the API answers instead, checked.
  it.each([
    ["records none", undefined],
    ["records another for a measure", Object.fromEntries(SUPPORTED_POLICY_IDS.map((id, i) => [id, i ? approvedDefinition(id) : { ...approvedDefinition(id), git_sha: "e".repeat(40) }]))],
  ])("ask the API for an example's result when the file %s", async (_, definitions) => {
    await chooseExample(definitions);
    expect(household.map((body) => body.include)).toEqual([[], ["sweep"], ["by_policy"]]);
  });
});

describe("a change in the title bar after a result", () => {
  // Published measures the household API answers for: an unmodelled one
  // makes the selection unavailable (#104)
  const props = {
    selectedPolicies: SUPPORTED_POLICY_IDS,
    policies: POLICIES_FOR_TEST,
  };

  it("reruns the same household for the new year, without a second Calculate", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />, { wrapper: PublishedMeasures });
    toResults();
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2029-30"));
    const asked = household.length;
    rerender(<PersonalImpactTab {...props} year={2030} />);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2030-31"));
    const later = household.slice(asked);
    expect(later[0].year).toBe(2030);
    expect(later[0].include).toEqual([]);
    // The same answers as the first calculation
    expect(later[0].household).toEqual(household[0].household);
  });

  it("does not rerun while the answers are being edited", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />, { wrapper: PublishedMeasures });
    toResults();
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2029-30"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "40" } });
    const asked = household.length;
    rerender(<PersonalImpactTab {...props} year={2030} />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household.length).toBe(asked);
    // The reader is asked to press Calculate
    expect(headlineCard()).toBeNull();
  });

  it("waits until the view is shown again when the year changes elsewhere", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />, { wrapper: PublishedMeasures });
    toResults();
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2029-30"));
    const asked = household.length;
    rerender(<PersonalImpactTab {...props} year={2030} active={false} />);
    rerender(<PersonalImpactTab {...props} year={2031} active={false} />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household.length).toBe(asked);
    rerender(<PersonalImpactTab {...props} year={2031} active />);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2031-32"));
    expect(household.slice(asked).map((body) => body.year)).not.toContain(2030);
  });
});

describe("while a new answer loads", () => {
  /** Serve the first answers at once, then hold every later request until released. */
  function serveSlowly() {
    const held = [];
    let slow = false;
    serve((body) => {
      if (!slow) return json(householdAnswerFor(body));
      return new Promise((resolve) => held.push(() => resolve(json(householdAnswerFor(body)))));
    });
    return {
      slowDown: () => {
        slow = true;
      },
      releaseAll: () => held.splice(0).forEach((release) => release()),
      held,
    };
  }

  it("moves keyboard focus from Calculate, disabled while it runs, to the results", async () => {
    serveSlowly().slowDown();
    renderTab();
    openForm();
    calculateButton().focus();
    fireEvent.click(calculateButton());
    expect(calculateButton()).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("region", { name: "Results" })).toHaveFocus());
  });

  it("shows only the processing panel while it calculates again, never the earlier result", async () => {
    const server = serveSlowly();
    const { rerender, container } = renderTab();
    toResults();
    await splitShown();
    expect(headlineCard()).toHaveTextContent("2029-30");
    server.slowDown();
    const ids = SUPPORTED_POLICY_IDS;
    rerender(<PersonalImpactTab selectedPolicies={ids} policies={POLICIES_FOR_TEST} year={2030} />);
    toResults();
    // The button is busy and cannot send twice
    expect(calculateButton()).toBeDisabled();
    expect(calculateButton()).toHaveTextContent("Calculating…");
    for (const wait of [0, 600]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      expect(headlineCard()).toBeNull();
      expect(container.querySelector(".single-year-details")).toBeNull();
      expect(document.querySelector(".net-income-waterfall")).toBeNull();
    }
    expect(container.querySelector(".processing-panel")).toHaveTextContent("Calculating your household");
    expect(container.querySelector(".processing-panel")).toHaveTextContent("Usually around 60 seconds");
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    server.releaseAll();
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2030-31"));
    expect(container.querySelector(".processing-panel")).toBeNull();
    // The breakdown stage: its cards wait with one message each
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    expect(container.querySelectorAll(".waiting-card")).toHaveLength(1);
    server.releaseAll();
    await splitShown("2030-31");
  });
});

describe("the household calculation's errors", () => {
  it("names a refused child's age as the children's, not yours", async () => {
    serve(() =>
      json({ detail: [{ loc: ["body", "household", "children", 0, "age"], msg: "Input should be less than or equal to 19" }] }, 422),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Children's ages: Input should be less than or equal to 19");
  });

  it("says what to do about a child of 20 or over", async () => {
    serve(() =>
      json(
        {
          detail: [
            {
              type: "less_than_equal",
              loc: ["body", "household", "children", 0, "age"],
              msg: "Input should be less than or equal to 19",
            },
          ],
        },
        422,
      ),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Children's ages: Children are 0 to 19.");
    expect(alert).toHaveTextContent("leave them out");
  });

  it("names the answers the API refused", async () => {
    serve(() =>
      json(
        {
          detail: [
            { loc: ["body", "household", "monthly_rent"], msg: "Input should be less than or equal to 100000" },
            { loc: ["body", "household", "age"], msg: "Input should be greater than or equal to 16" },
          ],
        },
        422,
      ),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Results are not available here.");
    expect(alert).toHaveTextContent("Monthly rent: Input should be less than or equal to 100000");
    expect(alert).toHaveTextContent("Age: Input should be greater than or equal to 16");
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("says when the build has no API URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "");
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    expect(await screen.findByRole("alert")).toHaveTextContent("NEXT_PUBLIC_HOUSEHOLD_API_URL is not set");
    expect(household).toEqual([]);
  });

  it("offers to try again after a server error, and recovers", async () => {
    let fail = true;
    serve((body) => (fail ? json({ detail: "boom" }, 500) : json(householdAnswerFor(body))));
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("answered with an error (500)");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(HEADLINE)).toBeInTheDocument();
  });

  it("shows the earnings charts as soon as the sweep arrives, while the split by policy is still running", async () => {
    let finishByPolicy;
    const byPolicyAsked = new Promise((resolve) => {
      finishByPolicy = resolve;
    });
    serve((body) =>
      body.include.includes("by_policy")
        ? byPolicyAsked.then(() => json(householdAnswerFor(body)))
        : json(householdAnswerFor(body)),
    );
    renderTab();
    toResults();
    expect(await screen.findByRole("heading", { name: /^Household net income, / })).toBeInTheDocument();
    expect(await screen.findByText(/Splitting the change by policy/)).toBeInTheDocument();
    finishByPolicy();
    await splitShown();
  });

  it("keeps the earnings charts when only the split by policy fails", async () => {
    serve((body) =>
      body.include.includes("by_policy") ? json({ detail: "boom" }, 503) : json(householdAnswerFor(body)),
    );
    renderTab();
    toResults();
    expect(await screen.findByText("The split by policy is not available.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^Household net income, / })).toBeInTheDocument();
    expect(screen.queryByText("The earnings charts are not available.")).not.toBeInTheDocument();
    // The waterfall keeps one step for every policy, and stops saying it is splitting
    expect(document.querySelector('.net-income-waterfall[data-split="unavailable"]')).not.toBeNull();
    expect(screen.queryByText(/Splitting the change by policy/)).toBeNull();
  });

  it("keeps the headline when only the breakdown fails", async () => {
    serve((body) =>
      body.include.length ? json({ detail: "boom" }, 503) : json(householdAnswerFor(body)),
    );
    renderTab();
    toResults();
    expect(await screen.findByText("The split by policy is not available.")).toBeInTheDocument();
    expect(screen.getByText("The earnings charts are not available.")).toBeInTheDocument();
    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("gives up on a calculation that takes too long", async () => {
    serve((_body, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const { postHouseholdImpact, buildHouseholdRequest } = await import("../../utils/householdImpactApi");
    const body = buildHouseholdRequest(
      { current_age: 30, current_salary: 30000, children_ages: "" },
      { year: 2029, policies: ["two_child_limit"] },
    );
    await expect(postHouseholdImpact(body, { timeoutMs: 20 })).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringMatching(/took longer than/),
    });
  });
});

describe("an unavailable household calculation", () => {
  it.each(["mixed", "only unmodelled"])("keeps the wizard but suppresses %s aggregate results", async (selection) => {
    const unmodelledId = HOUSEHOLD_FIXTURE.not_modelled[0].id;
    const ids = selection === "mixed" ? [...SUPPORTED_POLICY_IDS, unmodelledId] : [unmodelledId];
    serve((body) => {
      const answer = structuredClone(householdAnswerFor(body));
      // An API label never overrides the publication catalogue's label.
      answer.not_modelled[0].name = "A different API label";
      if (selection === "only unmodelled") {
        answer.net_income.reform = answer.net_income.baseline;
        answer.net_income.change = 0;
      }
      return json(answer);
    });
    renderTab({ selectedPolicies: ids });
    toResults();
    const panel = await results();
    expect(await within(panel).findByText("Household impact is unavailable for this selection")).toBeInTheDocument();
    expect(panel).toHaveTextContent(POLICIES_FOR_TEST.find((policy) => policy.id === unmodelledId).name);
    expect(panel).not.toHaveTextContent("A different API label");
    expect(panel).not.toHaveTextContent("£0");
    expect(screen.queryByText(HEADLINE)).toBeNull();
    expect(screen.queryByRole("region", { name: "Your household's results" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^More details/ })).toBeInTheDocument();
    expect(household.length).toBeGreaterThan(0);
  });
});

describe("the fixture", () => {
  it("is a real answer: per-policy rows plus the residual make the change", () => {
    const { by_policy: byPolicy, net_income: net } = HOUSEHOLD_FIXTURE;
    const singles = byPolicy.measures.reduce((sum, row) => sum + row.change, 0);
    expect(singles + byPolicy.residual).toBeCloseTo(net.change, 1);
    expect(byPolicy.combined).toBe(net.change);
    expect(Object.keys(HOUSEHOLD_FIXTURE).sort()).toEqual(
      [
        "area",
        "by_policy",
        "dependants",
        "dependants_note",
        "engine",
        "fiscal_year",
        "included",
        "net_income",
        "not_in_breakdown",
        "not_modelled",
        "programmes",
        "salary_used",
        "sweep",
        "year",
      ].sort(),
    );
    expect(HOUSEHOLD_FIXTURE.sweep.points).toHaveLength(HOUSEHOLD_FIXTURE.sweep.marginal_rates.length + 1);
  });
});

// W5's page follow-up to #125 (coordinator's ruling): measures the API's
// code computes from other definitions are listed unavailable, with the
// existing remove action, and no figure is shown
describe("a household calculation from other definitions", () => {
  const [changedId] = [...SUPPORTED_POLICY_IDS].sort();
  const changedName = POLICIES_FOR_TEST.find((policy) => policy.id === changedId).name;
  const otherDefinition = (id) => {
    const definition = approvedDefinition(id);
    return id === changedId ? { ...definition, reform: { ...definition.reform, binding: "code_revision" } } : definition;
  };

  it("lists the measure unavailable, says how it differs, and offers to remove it", async () => {
    serve((body) => json(householdAnswerFor(body)), otherDefinition);
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    toResults();
    const region = await results();
    expect(await within(region).findByText("Household impact is unavailable for the selected measures")).toBeInTheDocument();
    expect(within(region).getByText(/does not compute these measures from the definitions/)).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual([`${changedName}: its reform binding differs`]);
    expect(within(region).queryByText(HEADLINE)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your household's results" })).not.toBeInTheDocument();
    // No figure beside the form (the form's own answers show their pounds)
    expect(region.textContent).not.toMatch(/£\d/);
    fireEvent.click(within(region).getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith([changedId]);
    // Refused at the headline: the breakdown was never asked for
    expect(yours().map((body) => body.include)).toEqual([[]]);
  });

  it("shows the results once the API computes every measure from its approved definition", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText("Household impact is unavailable for the selected measures")).not.toBeInTheDocument();
  });
  // Review of 0608183, finding 7: a build that reports no definitions
  // (one before #125) gives nothing to tell the measures apart by
  it("says the answers can't be checked when the API reports no definitions, and offers to ask again, not to remove every measure", async () => {
    let reports = false;
    household = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const body = JSON.parse(init.body);
      household.push(body);
      const answer = json(householdAnswerFor(body));
      return reports ? withReportedDefinitions(answer, url) : answer;
    }));
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    toResults();
    const region = await results();
    expect(await within(region).findByText("Household impact can't be checked right now")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    expect(within(region).queryByText(HEADLINE)).not.toBeInTheDocument();
    expect(region.textContent).not.toMatch(/£\d/);
    expect(screen.queryByRole("region", { name: "Your household's results" })).not.toBeInTheDocument();
    // Asked again once the API reports them, it answers
    reports = true;
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    expect(yours().map((body) => body.include)).toEqual([[], [], ["sweep"], ["by_policy"]]);
  });

  // Review of 4be6bd9f (findings 1 and 2): a refusal answers the answers,
  // year and policies sent, and gives way once they change, as #128's
  // headline does. It never lists a measure no longer selected, nor refuses
  // one as having no approved definition when it is only no longer selected
  const NOTICE = "Household impact is unavailable for the selected measures";
  const UNCHECKED = "Household impact can't be checked right now";
  const SELECT = /Select at least one policy/;
  // An edit after a result or a refusal: the box goes, with nothing in its
  // place until Calculate (#185's cards say what to do), so no refusal
  // outlives the answers it was made for
  const noResults = () => {
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByText(UNCHECKED)).toBeNull();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
  const tab = (selectedPolicies) => (
    <PersonalImpactTab selectedPolicies={selectedPolicies} policies={POLICIES_FOR_TEST} year={2029} />
  );
  const editAnswers = () => fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "40" } });
  const uncheckedApi = () => {
    household = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const body = JSON.parse(init.body);
      household.push(body);
      return json(householdAnswerFor(body));
    }));
  };

  it("removing the only selected measure, refused, leaves the prompt to select one", async () => {
    serve((body) => json(householdAnswerFor(body)), otherDefinition);
    const { rerender } = renderTab({ selectedPolicies: [changedId] });
    toResults();
    expect(await within(await results()).findByText(NOTICE)).toBeInTheDocument();
    rerender(tab([]));
    await settle();
    const region = await results();
    expect(within(region).queryByText(NOTICE)).not.toBeInTheDocument();
    expect(within(region).getByText(SELECT)).toBeInTheDocument();
  });

  it("removing the refused measure while others stay asks again without Calculate", async () => {
    serve((body) => json(householdAnswerFor(body)), otherDefinition);
    const { rerender } = renderTab();
    toResults();
    expect(await within(await results()).findByText(NOTICE)).toBeInTheDocument();
    const rest = SUPPORTED_POLICY_IDS.filter((id) => id !== changedId);
    rerender(tab(rest));
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(yours().at(-1).policies).toEqual(rest);
  });

  it("an edit after a refusal takes it away, and removing the measure then brings nothing back", async () => {
    serve((body) => json(householdAnswerFor(body)), otherDefinition);
    const { rerender } = renderTab();
    toResults();
    expect(await within(await results()).findByText(NOTICE)).toBeInTheDocument();
    editAnswers();
    noResults();
    const asked = yours().length;
    rerender(tab(SUPPORTED_POLICY_IDS.filter((id) => id !== changedId)));
    await settle();
    noResults();
    // The edited answers wait for Calculate
    expect(yours().length).toBe(asked);
  });

  it("can't-be-checked gives way when every measure is taken out of the bar", async () => {
    uncheckedApi();
    const { rerender } = renderTab();
    toResults();
    expect(await within(await results()).findByText(UNCHECKED)).toBeInTheDocument();
    rerender(tab([]));
    const region = await results();
    expect(within(region).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(region).getByText(SELECT)).toBeInTheDocument();
  });

  it("can't-be-checked gives way after an edit and a measure taken out", async () => {
    uncheckedApi();
    const { rerender } = renderTab();
    toResults();
    expect(await within(await results()).findByText(UNCHECKED)).toBeInTheDocument();
    editAnswers();
    const [, ...rest] = SUPPORTED_POLICY_IDS;
    const asked = yours().length;
    rerender(tab(rest));
    await settle();
    noResults();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(yours().length).toBe(asked);
  });

  it("a submission restored on coming back that names a removed measure shows no refusal", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const first = renderTab();
    toResults();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    editAnswers();
    // The calculator is rebuilt (a gate notice replaced it, or the snapshot
    // changed) with one measure fewer selected
    first.unmount();
    const [, ...rest] = SUPPORTED_POLICY_IDS;
    const asked = yours().length;
    render(tab(rest), { wrapper: PublishedMeasures });
    await settle();
    noResults();
    expect(yours().length).toBe(asked);
  });

  // Re-review of bc41dada (finding A): the hook checks a request again
  // when the definitions of the measures it asks about change, so a
  // refusal made against the selection on coming back doesn't outlive it
  it("a restored submission shows its result once its removed measure is back and the edit undone", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const first = renderTab();
    toResults();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    editAnswers();
    first.unmount();
    const [, ...rest] = SUPPORTED_POLICY_IDS;
    const { rerender } = render(tab(rest), { wrapper: PublishedMeasures });
    await settle();
    noResults();
    // The measure comes back and the edit is undone: the restored
    // submission is the request on the page again
    rerender(tab(SUPPORTED_POLICY_IDS));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "30" } });
    const region = await results();
    expect(await within(region).findByText(HEADLINE)).toBeInTheDocument();
    expect(within(region).queryByText(NOTICE)).not.toBeInTheDocument();
    expect(household.at(-1).policies).toEqual(SUPPORTED_POLICY_IDS);
  });

  it("names only the definitions of the measures it asks about", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const urls = [];
    const served = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      urls.push(String(url));
      return served(url, init);
    }));
    const first = renderTab();
    toResults();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    editAnswers();
    first.unmount();
    // Asked again on coming back, with another measure selected besides:
    // its definition is the selection's, not the request's
    clearHouseholdImpactCache();
    const [extra] = POLICIES_FOR_TEST.map((policy) => policy.id).filter((id) => !SUPPORTED_POLICY_IDS.includes(id));
    const before = urls.length;
    render(tab([...SUPPORTED_POLICY_IDS, extra]), { wrapper: PublishedMeasures });
    await waitFor(() => expect(urls.length).toBeGreaterThan(before));
    expect(household.at(-1).policies).toEqual(SUPPORTED_POLICY_IDS);
    // The household API's requests (the page also loads its files)
    const asked = urls.filter((url) => route(url) === HOUSEHOLD_API);
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) {
      expect(requestedDefinitions(url).map(([id]) => id).sort()).toEqual([...SUPPORTED_POLICY_IDS].sort());
    }
  });

  // Review of 0608183, finding 2: published before the deploy that
  // registers it, or after a rollback past it
  it("lists a measure the running code doesn't register as unavailable, with the remove action", async () => {
    serve((body) => json({
      detail: [{ type: "value_error", loc: ["body", "policies"], msg: `Value error, Unknown measures: ${changedId}`, input: body.policies, ctx: { error: {} } }],
    }, 422));
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    toResults();
    const region = await results();
    expect(await within(region).findByText("Household impact is unavailable for the selected measures")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      `${changedName}: the running code cannot bind it: not a measure the running code registers`,
    ]);
    fireEvent.click(within(region).getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith([changedId]);
  });
});

describe("keepSentence: the marginal rate as money", () => {
  it("keeps of the next £1,000, before and after, once when they round the same", () => {
    expect(keepSentence(0.62, 0.62)).toBe("Of your next £1,000 of earnings, you keep £380.");
    expect(keepSentence(0.62, 0.65)).toBe("Of your next £1,000 of earnings, you keep £380 before and keep £350 after.");
  });

  it("says a loss as a loss", () => {
    expect(keepSentence(1.05, 0.55)).toBe("Of your next £1,000 of earnings, you would lose £50 before and keep £450 after.");
  });

  it("turns to the next £200 at a cliff, where £1,000 would overstate it", () => {
    // Net income falls £2,140 over the next £200 before, £32 kept after
    expect(keepSentence(11.7, 0.84)).toBe("Of your next £200 of earnings, you would lose £2,140 before and keep £32 after.");
    expect(keepSentence(11.7, 11.7)).toBe("Of your next £200 of earnings, you would lose £2,140.");
  });

  it("is null without both rates", () => {
    expect(keepSentence(null, 0.4)).toBeNull();
    expect(keepSentence(0.4, undefined)).toBeNull();
  });
});

describe("the assumed-spending caution", () => {
  const byPolicy = (rows) => ({ measures: rows.map(([id, change]) => ({ id, change })) });

  it("says most of a change is from spending only when those measures are more than half of it", () => {
    const fuel = byPolicy([["fuel_duty_rise_deferral", 60], ["domestic_electricity_zero_vat", 30], ["state_pension_income_tax_protection", 10]]);
    expect(mostlyFromSpending(fuel, 100)).toBe(true);
    const pension = byPolicy([["fuel_duty_rise_deferral", 20], ["state_pension_income_tax_protection", 80]]);
    expect(mostlyFromSpending(pension, 100)).toBe(false);
    // A loss mostly from elsewhere, a gain from spending: not "most of this"
    expect(mostlyFromSpending(byPolicy([["road_fuel_vat_cut", 10]]), -50)).toBe(false);
    expect(mostlyFromSpending(null, 100)).toBe(false);
    expect(mostlyFromSpending(fuel, 0)).toBe(false);
  });

  it("calls spending assumed at the prefilled averages or an example's figure, not once the reader enters their own", () => {
    expect(spendingAssumed(WIZARD_DEFAULTS, null)).toBe("average");
    expect(spendingAssumed(WIZARD_DEFAULTS, "driver")).toBe("average");
    const own = { ...WIZARD_DEFAULTS, petrol_spending_per_year: 2600 };
    expect(spendingAssumed(own, "driver")).toBe("example");
    expect(spendingAssumed(own, null)).toBeNull();
  });
});


describe("the Across earnings cards together", () => {
  it("switch view together, and a chip toggled on one is toggled on the other", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await waitFor(() => expect(container.querySelector(".single-year-chart-pair .earnings-svg")).not.toBeNull(), { timeout: 5000 });
    const pair = container.querySelector(".single-year-chart-pair");
    const [netCard, rateCard] = pair.querySelectorAll(".single-year-card");
    chooseOption(netCard, "Before");
    expect(optionsLabel(rateCard)).toBe("Before");
    // Where both cards have their parts, a chip toggled on one is toggled
    // on the other, and both keys list the same components in order
    const rateChip = within(rateCard).queryByRole("button", { name: "Income tax" });
    const netChip = within(netCard).queryByRole("button", { name: "Income tax" });
    if (rateChip && netChip) {
      expect(rateChip).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(netChip);
      expect(within(rateCard).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "false");
      const labels = (card) => [...card.querySelectorAll(".series-toggle-chip")].map((button) => button.textContent).slice(0, -1);
      expect(labels(netCard)).toEqual(labels(rateCard));
    }
  });
});

describe("the breakdown's one line", () => {
  it("says which groups the policies change, and which they leave", async () => {
    const { breakdownSentence } = await import("./ProgrammeTable");
    const row = (label, change) => ({ label, shown: { change } });
    const group = (id, change, rows) => ({ id, shown: { change }, rows });
    // Taxes only; a household with no benefits still hears benefits are unchanged
    expect(breakdownSentence([group("income", 0), group("tax", 60)])).toBe(
      "Taxes fall by £60 a year; market income and benefits are unchanged.",
    );
    // The row behind most of the change, by name
    expect(
      breakdownSentence([
        group("income", 0),
        group("tax", 9, [row("Fuel duty", 8), row("VAT", 1), row("Council Tax", 0)]),
        group("benefit", 0),
      ]),
    ).toBe("Taxes fall by £9 a year, mostly fuel duty; market income and benefits are unchanged.");
    expect(breakdownSentence([group("income", 0), group("tax", -20, [row("VAT change", -20), row("Income tax", 0)]), group("benefit", 0)])).toBe(
      "Taxes rise by £20 a year, all from VAT; market income and benefits are unchanged.",
    );
    // Both, and no row named when none is more than half
    expect(
      breakdownSentence([
        group("income", 0),
        group("tax", -20, [row("Income tax", -10), row("National Insurance", -10)]),
        group("benefit", -15, [row("Universal Credit", -15)]),
      ]),
    ).toBe("Taxes rise by £20 a year; benefits fall by £15 a year, all from Universal Credit; market income is unchanged.");
    expect(breakdownSentence([group("income", 0), group("tax", 0), group("benefit", 30)])).toBe(
      "Benefits rise by £30 a year; market income and taxes are unchanged.",
    );
    expect(breakdownSentence([group("income", 120), group("tax", 0), group("benefit", 0)])).toBe(
      "Market income rises by £120 a year; taxes and benefits are unchanged.",
    );
    expect(breakdownSentence([group("income", 0), group("tax", 0), group("pension", 0)])).toBe("No change to your taxes or benefits.");
  });
});

describe("the breakdown's rows", () => {
  // A pensioner's taxes: Council Tax and the TV licence unchanged, VAT only
  // as the change the measures make (a £1 cut)
  const programmes = [
    { id: "state_pension", group: "benefit", label: "State Pension", before: 12000, after: 12000 },
    { id: "council_tax", group: "tax", label: "Council Tax", before: 2000, after: 2000 },
    { id: "tv_licence", group: "tax", label: "TV licence", before: 175, after: 175 },
    { id: "vat_change", group: "tax", label: "VAT", before: 0, after: -1 },
  ];
  const totals = { before: 9825, after: 9826, change: 1 };

  it("shows VAT as a change only, Council Tax as a proper noun, and the unchanged rows", async () => {
    const { default: ProgrammeTable } = await import("./ProgrammeTable");
    render(<ProgrammeTable programmes={programmes} totals={totals} yearLabel="2029-30" />);
    const table = screen.getByRole("table");
    const vat = within(table).getByRole("row", { name: /VAT change/ });
    // No before; the cut a positive amount after, as a smaller tax
    expect(vat).toHaveTextContent("—+£1+£1");
    expect(within(table).getByRole("row", { name: /Council Tax/ })).toHaveTextContent("−£2,000−£2,000—");
    expect(within(table).getByRole("row", { name: /TV licence/ })).toHaveTextContent("−£175−£175—");
    expect(within(table).queryByText("Council tax")).toBeNull();
    // Taxes still add up to the rows under it
    expect(within(table).getByRole("row", { name: /^Taxes/ })).toHaveTextContent("−£2,175−£2,174+£1");
    // Net income's name is in the bold total row
    expect(within(table).getByRole("rowheader", { name: "Net income" }).closest("tr")).toHaveClass("breakdown-net-row");
    // About this chart says the VAT row is the change only
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/not the VAT you pay/)).toBeInTheDocument();
  });
});

describe("the waterfall's one line", () => {
  it("leads with the change, then the policy that moves it most: gains, losses, mixed, one, none", async () => {
    const { waterfallSentence, waterfallScaleStart } = await import("./NetIncomeWaterfall");
    const totals = { before: 70050, after: 70159 };
    const step = (name, rounded) => ({ id: name, name, rounded });
    expect(waterfallSentence(totals, [step("Zero VAT on electricity", 56), step("Fuel duty deferral", 53)], "2027-28")).toBe(
      "Your net income rises in 2027-28, mostly from Zero VAT on electricity (+£56).",
    );
    expect(waterfallSentence(totals, [step("A", 40), step("B", 35), step("C", 34)], "2027-28")).toBe(
      "Your net income rises in 2027-28; A adds the most (+£40).",
    );
    expect(waterfallSentence(totals, [step("Zero VAT on electricity", 204), step("Threshold freeze", -95)], "2027-28")).toBe(
      "Your net income rises in 2027-28: Zero VAT on electricity adds the most (+£204) and Threshold freeze takes the most (−£95).",
    );
    expect(waterfallSentence({ before: 100, after: 50 }, [step("Fuel duty", 20), step("Threshold freeze", -70)], "2031-32")).toBe(
      "Your net income falls in 2031-32: Threshold freeze takes the most (−£70) and Fuel duty adds the most (+£20).",
    );
    expect(waterfallSentence({ before: 100, after: 80 }, [step("Threshold freeze", -20)], "2031-32")).toBe(
      "Your net income falls in 2031-32, all from Threshold freeze.",
    );
    expect(waterfallSentence({ before: 100, after: 100 }, [], "2027-28")).toBe("No change to your net income in 2027-28.");
    // No change, before or after amount: the tile and the bars' end labels show them
    expect(waterfallSentence(totals, [step("Zero VAT on electricity", 56)], "2027-28")).not.toMatch(/109|70,050|70,159/);
    // While the split is calculated, the change alone
    expect(waterfallSentence(totals, null, "2027-28")).toBe("Your net income rises in 2027-28.");
    // The bars start a round £100 below the lowest point
    expect(waterfallScaleStart({ before: 17947, after: 18007 }, [step("A", 43), step("B", 17)])).toBe(17800);
  });

  it("never lower-cases a measure's name: State Pension stays a proper noun", async () => {
    const { waterfallSentence } = await import("./NetIncomeWaterfall");
    const step = (label, rounded) => ({ id: label, name: label, label, rounded });
    expect(
      waterfallSentence({ before: 100, after: 400 }, [step("State Pension protection", 225), step("Fuel duty deferral", 75)], "2029-30"),
    ).toBe("Your net income rises in 2029-30, mostly from State Pension protection (+£225).");
  });

  it("shows no sentence over the chart: the largest policy is marked on it, the sentence its text alternative", async () => {
    const { render } = await import("@testing-library/react");
    const { default: NetIncomeWaterfall, largestSteps } = await import("./NetIncomeWaterfall");
    const step = (id, rounded) => ({ id, name: id, label: id, rounded });
    // One way: one "Largest"; both ways: the largest gain and loss; one
    // policy, or the one step while splitting: none
    expect(largestSteps([step("a", 225), step("b", 75)])).toEqual({ a: "Largest" });
    expect(largestSteps([step("a", -30), step("b", -90)])).toEqual({ b: "Largest" });
    expect(largestSteps([step("a", 204), step("b", -95), step("c", 10), step("interaction", -300)])).toEqual({
      a: "Largest gain",
      b: "Largest loss",
    });
    expect(largestSteps([step("a", 56)])).toEqual({});
    expect(largestSteps(null)).toEqual({});

    const { container, unmount } = render(
      <NetIncomeWaterfall
        totals={{ before: 18000, after: 18300, change: 300 }}
        steps={[step("State Pension protection", 225), step("Fuel duty deferral", 75)]}
        yearLabel="2029-30"
      />,
    );
    expect(container.querySelector(".waterfall-sentence")).toBeNull();
    expect(container.querySelector(".waterfall-header").textContent).toBe("How each policy changes your income" + container.querySelector(".visually-hidden").textContent);
    const chart = container.querySelector("ol.waterfall-rows");
    const described = document.getElementById(chart.getAttribute("aria-describedby"));
    expect(described).toHaveClass("visually-hidden");
    expect(described).toHaveTextContent("Your net income rises in 2029-30, mostly from State Pension protection (+£225).");
    const largest = [...container.querySelectorAll(".waterfall-row.is-largest")];
    expect(largest.map((row) => row.dataset.row)).toEqual(["State Pension protection"]);
    expect(largest[0].querySelector(".waterfall-chip")).toHaveTextContent(/^Largest$/);
    // The chip adds no number: the row's value is said once
    expect(largest[0].textContent.match(/£225/g)).toHaveLength(1);
    unmount();

    // Mixed: both chips
    const mixed = render(
      <NetIncomeWaterfall
        totals={{ before: 18000, after: 18109, change: 109 }}
        steps={[step("Zero VAT on electricity", 204), step("Threshold freeze", -95)]}
        yearLabel="2027-28"
      />,
    );
    expect([...mixed.container.querySelectorAll(".waterfall-chip")].map((chip) => chip.textContent)).toEqual([
      "Largest gain",
      "Largest loss",
    ]);
    mixed.unmount();

    // One policy: no chip, the sentence still the text alternative
    const one = render(
      <NetIncomeWaterfall totals={{ before: 100, after: 80, change: -20 }} steps={[step("Threshold freeze", -20)]} yearLabel="2031-32" />,
    );
    expect(one.container.querySelector(".waterfall-chip")).toBeNull();
    expect(one.container.querySelector(".visually-hidden")).toHaveTextContent("all from Threshold freeze.");
    one.unmount();

    // No change: the note is shown
    const none = render(<NetIncomeWaterfall totals={{ before: 100, after: 100, change: 0 }} steps={[]} yearLabel="2027-28" />);
    expect(none.container.querySelector(".waterfall-no-change")).toHaveTextContent("No change to your net income in 2027-28.");
    expect(none.container.querySelector(".waterfall-chip")).toBeNull();
    none.unmount();
  });

  it("gives the result card no coloured left stripe: gain and loss colour only the numbers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "components", "personal", "SingleYear.css"), "utf8");
    const cardRules = [...css.matchAll(/\.result-card(?:\.is-(?:gain|loss))?\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(cardRules.length).toBeGreaterThan(0);
    for (const rule of cardRules) expect(rule).not.toMatch(/border-left/);
  });
});

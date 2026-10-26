import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "../PersonalImpactTab";
import { resetSavedWizard } from "../HouseholdCalculator";
import { clearHouseholdImpactCache } from "../../hooks/useHouseholdImpact";
import { PRESET_POLICIES, presetRequests, resetPresetResults } from "../../utils/householdPresets";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../../test/householdFixture";
import { POLICIES_FOR_TEST } from "../../test/personalPolicies";
import { keepSentence } from "../../utils/singleYear";

const HOUSEHOLD_API = "https://api.test/api/household-impact";

let household;

/** Answer the household API with `respond(body)`; any other URL is a 404. */
function serve(respond) {
  household = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (url === HOUSEHOLD_API) {
        const body = JSON.parse(init.body);
        household.push(body);
        return respond(body, init);
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

function renderTab(props = {}) {
  return render(
    <PersonalImpactTab
      selectedPolicies={POLICIES_FOR_TEST.map((policy) => policy.id)}
      policies={POLICIES_FOR_TEST}
      year={2029}
      {...props}
    />,
  );
}

// Nothing is asked until Calculate: every answer has a default, so one
// press gives the results
const calculateButton = () => screen.getByRole("button", { name: /^Calcul/ });
/** Open the form below the cards ("Your household"), unless it is open. */
function openForm() {
  const yours = screen.getByRole("button", { name: /^Your household/ });
  if (yours.getAttribute("aria-expanded") !== "true") fireEvent.click(yours);
}
function toResults() {
  openForm();
  fireEvent.click(calculateButton());
}

// The headline card's label, once a result is shown
const HEADLINE = /^Change in your net income$/;
/** The headline card (there is none before a result). */
const headlineCard = () => document.querySelector(".result-card");
/** The headline figure, once it has counted up. */
const changeValue = () => headlineCard().querySelector(".result-value").textContent;

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
    // Besides the examples' precomputed file and the example households'
    // income charts below the calculator, only the household route
    const urls = fetch.mock.calls
      .map(([url]) => url)
      .filter((url) => !url.endsWith("/household_presets.json") && !url.endsWith("/income_curve.csv"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url === HOUSEHOLD_API)).toBe(true);
  });
});

describe("the household calculation, from the fixture", () => {
  it("asks for the headline first, then the sweep and the split by policy at once, with the wizard's answers", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
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

  it("shows the result card and breakdown once only the headline has resolved", async () => {
    // The slower parts never answer: the headline must not wait for them
    serve((body) =>
      body.include.length === 0 ? json(householdAnswerFor(body)) : new Promise(() => {}),
    );
    renderTab();
    toResults();
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    expect(document.querySelector("#household-breakdown")).not.toBeNull();
    // The split by policy and the sweep wait in their own cards
    await waitFor(() => expect(document.querySelectorAll(".waiting-card")).toHaveLength(2));
    expect(await screen.findAllByText("Usually around 60 seconds")).toHaveLength(2);
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
    expect(card.querySelector(".result-card-label")).toHaveTextContent("Change in your net income");
    // The year and the number of policies as pills
    const pills = [...card.querySelectorAll(".result-pill")].map((pill) => pill.textContent);
    expect(pills).toEqual(["2029-30", `${POLICIES_FOR_TEST.length} policies`]);
    expect(changeValue()).toBe("+£3,765");
    // The figure once, for copying and screen readers alike
    expect(card.textContent.match(/£3,765/g)).toHaveLength(1);
    expect(card.querySelector(".result-figure")).toHaveTextContent(/^\+£3,765 a year$/);
    // Its share as a chip, and net income before and after as bars
    expect(card.querySelector(".result-chip")).toHaveTextContent("Up 5.8% of net income");
    const bars = [...card.querySelectorAll(".result-bar-row")].map((row) => row.textContent);
    expect(bars).toEqual(["Before£65,371", "After£69,136"]);
    expect(panel.querySelectorAll(".result-card")).toHaveLength(1);
    // The change is said once: no sentence repeating it
    expect(panel).not.toHaveTextContent("The selected policies would");
    expect(panel).not.toHaveTextContent("before and after the selected policies.");
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
    expect(within(box("Rent area")).getByRole("tooltip")).toHaveTextContent("region default");
    expect(box("Rail fares freeze").querySelector("dd")).toHaveTextContent("not shown");
    expect(panel).not.toHaveTextContent("spreads a national cost");
    expect(panel.textContent.match(/Rent area/g)).toHaveLength(1);
    // No child of 16 or over: no item on who counts as a child
    expect(panel).not.toHaveTextContent("Children 16 to 19");
  });

  it("draws one bar per policy that changes the household, adding up to the change", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    const bars = [...container.querySelectorAll(".policy-bar")];
    expect(bars.map((bar) => bar.dataset.policy)).toEqual([
      "two_child_limit",
      "threshold_freeze_extension",
      "salary_sacrifice_cap",
      "fuel_duty_freeze",
    ]);
    const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));
    const sum = bars
      .map((bar) => parse(bar.querySelector(".policy-bar-value").textContent))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(parse(changeValue()));
    expect(sum).toBe(3765);
    // The measures that leave the household where it was: one expander
    // under the chart, closed at first, each on its own row with its colour
    const chart = container.querySelector("#change-by-policy");
    const noEffect = within(chart).getByRole("button", { name: "More info" });
    expect(noEffect).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".no-effect-item")).toBeNull();
    fireEvent.click(noEffect);
    expect(noEffect).toHaveAttribute("aria-expanded", "true");
    const items = [...container.querySelectorAll(".no-effect-item")];
    expect(chart.querySelector(".no-effect-title")).toHaveTextContent(`No effect on your household (${items.length})`);
    expect(items.map((item) => item.querySelector(".no-effect-name").textContent)).toContain(
      "Dividend tax increase (+2pp)",
    );
    expect(items.every((item) => item.querySelector(".no-effect-dot").style.background)).toBe(true);
    expect(container.querySelector('[data-policy="interaction"]')).toBeNull();
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
    expect(rowNames()).toEqual(["Market income", "Taxes", "Benefits", "Net income"]);
    for (const name of ["Before", "After", "Change"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    // Net income: before and after only; its change is the headline card
    const net = within(table).getByRole("row", { name: /Net income/ });
    expect(net).toHaveTextContent("£65,371£69,136");
    expect(net).not.toHaveTextContent("£3,765");

    // Each top row opens to its taxes or benefits, closed at first
    expect(within(table).queryByText("Income tax")).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /Taxes/ }));
    const incomeTax = within(table).getByRole("row", { name: /Income tax/ });
    expect(incomeTax).toHaveTextContent("−£4,164−£4,360−£196");
    expect(within(incomeTax).getByText("−£196")).toHaveClass("is-loss");
    // And a programme to its parts
    fireEvent.click(within(table).getByRole("button", { name: /Income tax/ }));
    expect(within(table).getByText("On earnings")).toBeInTheDocument();

    // The top rows add up to net income, in every column
    const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));
    const top = [...table.querySelectorAll(".programme-row.depth-0")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => parse(cell.textContent)),
    );
    const sums = [0, 1, 2].map((col) => top.reduce((acc, row) => acc + row[col], 0));
    expect(sums).toEqual([65371, 69136, 3765]);

    // About these figures: closed under the table, then the rows' notes
    // and the method as definition lists
    const about = screen.getByRole("button", { name: "About these figures" });
    expect(about).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Elements are before the earnings taper/)).not.toBeInTheDocument();
    fireEvent.click(about);
    expect(about).toHaveAttribute("aria-expanded", "true");
    const panel = about.closest(".disclosure");
    expect(panel).toHaveClass("disclosure-in-card");
    const terms = [...panel.querySelectorAll("dt")].map((term) => term.textContent);
    expect(terms).toContain("Universal Credit");
    expect(terms).toContain("Change by policy");
    expect(within(panel).getByText(/Elements are before the earnings taper/).tagName).toBe("DD");
    expect(within(panel).getByText(/Each bar is one policy on its own/)).toBeInTheDocument();
    // The marginal rate's known limits
    expect(within(panel).getByText(/^Known limits: Council Tax Reduction/)).toBeInTheDocument();
    expect(within(panel).getByText(/policyengine-uk 2\.134\.3 fixes this/)).toBeInTheDocument();
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
    // Each card's switch sits in the controls row, so the pair's rows line up
    expect(earnings.querySelector(".chart-controls .obr-view-switch")).not.toBeNull();
    expect(rate.querySelector(".chart-controls .obr-view-switch")).not.toBeNull();
    // Net income first: before and after, marking you
    const net = within(earnings).getByRole("button", { name: "Net income" });
    expect(net).toHaveAttribute("aria-pressed", "true");
    expect(earnings.querySelector(".earnings-you")).toHaveTextContent("You");
    expect(within(earnings).getByText("After the selected policies")).toBeInTheDocument();
    // Change: the gain and loss key, still marking you
    fireEvent.click(within(earnings).getByRole("button", { name: "Change" }));
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
      <PersonalImpactTab selectedPolicies={POLICIES_FOR_TEST.map((p) => p.id)} policies={POLICIES_FOR_TEST} year={2030} />,
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
    fireEvent.click(within(screen.getByRole("region", { name: "Choose a household" })).getByRole("button", { name: /^A 22-year-old renting/ }));
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    expect(household[0].household.age).toBe(22);
    // "Change these answers" opens the form with its answers, and
    // Calculate, to change one and calculate again
    fireEvent.click(screen.getByRole("button", { name: "Change these answers" }));
    expect(screen.getByRole("spinbutton", { name: "Age" })).toHaveValue(22);
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
  it("closes the form, scrolls its result into view below the bars and moves focus to it", async () => {
    serve((body) => json(householdAnswerFor(body)));
    // jsdom has no scrolling
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    // The result appears below the screen's foot
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 1500, bottom: 1900, height: 400 });
    renderTab();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: /^A pensioner on the State Pension/ }));
    expect(screen.getByRole("button", { name: /^Your household/ })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "start" });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Results" }));
    delete Element.prototype.scrollIntoView;
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
        if (url !== HOUSEHOLD_API) return Promise.resolve(new Response("{}", { status: 404 }));
        const body = JSON.parse(init.body);
        household.push(body);
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          held.push({ body, release: (change) => resolve(json(answerWith(body, change))) });
        });
      }),
    );
    return held;
  }
  const card = (name) =>
    within(screen.getByRole("region", { name: "Choose a household" })).getByRole("button", { name: new RegExp(`^${name}`) });

  it("clears the previous card's result at once, shows the new one when it arrives, and ignores a late answer for the previous card", async () => {
    const held = serveHeld();
    renderTab();
    // Example A: its headline arrives; its split by policy and sweep are
    // still out when the reader moves on
    fireEvent.click(card("A 22-year-old renting"));
    await waitFor(() => expect(held).toHaveLength(1));
    held[0].release(1111);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£1,111"));
    await waitFor(() => expect(held).toHaveLength(3));
    expect(screen.getByText(/Earns £25,000/)).toBeInTheDocument();
    // Example B: A's result and note go at once; B's own note, and a
    // loading state, not A's figures
    fireEvent.click(card("A pensioner on the State Pension"));
    expect(headlineCard()).toBeNull();
    expect(screen.queryByText("+£1,111")).toBeNull();
    expect(screen.queryByText(/Earns £25,000/)).toBeNull();
    expect(screen.getByText(/Aged 70 with the full new State Pension/)).toBeInTheDocument();
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

  it("from an example to Your household: the example's result and note go, and your own answers come back", async () => {
    serve((body) => json(answerWith(body, body.household.age === 22 ? 1111 : 3333)));
    renderTab();
    // Your own household first (age 41), calculated
    openForm();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Age" }), { target: { value: "41" } });
    fireEvent.click(calculateButton());
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£3,333"));
    // An example
    fireEvent.click(card("A 22-year-old renting"));
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£1,111"));
    expect(screen.getByText(/Earns £25,000/)).toBeInTheDocument();
    // Your household: never the example's result or note
    fireEvent.click(card("Your household"));
    expect(screen.queryByText("+£1,111")).toBeNull();
    expect(screen.queryByText(/Earns £25,000/)).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Age" })).toHaveValue(41);
    await waitFor(() => expect(headlineCard()).toHaveTextContent("+£3,333"));
  });
});

describe("the examples' precomputed results", () => {
  it("show an example's result from the published file, with no request to the API", async () => {
    // The file as the precompute writes it: the API's answer for each
    // example's own request (here the fixture's answer)
    const entries = presetRequests().map(({ preset_id, year, request }) => ({
      preset_id,
      year,
      request,
      response: householdAnswerFor(request),
    }));
    household = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (url.endsWith("/data/household_presets.json")) return json({ entries });
        household.push(JSON.parse(init.body));
        return json(householdAnswerFor(JSON.parse(init.body)));
      }),
    );
    render(
      <PersonalImpactTab selectedPolicies={PRESET_POLICIES} policies={POLICIES_FOR_TEST} year={2029} />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^A graduate on £35,000/ }));
    await waitFor(() => expect(headlineCard()).not.toBeNull());
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    expect(household).toEqual([]);
  });
});

describe("a change in the title bar after a result", () => {
  const props = {
    selectedPolicies: POLICIES_FOR_TEST.map((policy) => policy.id),
    policies: POLICIES_FOR_TEST,
  };

  it("reruns the same household for the new year, without a second Calculate", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />);
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
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />);
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
    const { rerender } = render(<PersonalImpactTab {...props} year={2029} />);
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

  it("shows only the processing panel while it calculates again, never the earlier result", async () => {
    const server = serveSlowly();
    const { rerender, container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    expect(headlineCard()).toHaveTextContent("2029-30");
    server.slowDown();
    const ids = POLICIES_FOR_TEST.map((p) => p.id);
    rerender(<PersonalImpactTab selectedPolicies={ids} policies={POLICIES_FOR_TEST} year={2030} />);
    toResults();
    // The button is busy and cannot send twice
    expect(calculateButton()).toBeDisabled();
    expect(calculateButton()).toHaveTextContent("Calculating…");
    for (const wait of [0, 600]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      expect(headlineCard()).toBeNull();
      expect(container.querySelector(".single-year-details")).toBeNull();
      expect(screen.queryByRole("heading", { name: /Change in net income by policy/ })).toBeNull();
    }
    expect(container.querySelector(".processing-panel")).toHaveTextContent("Calculating your household");
    expect(container.querySelector(".processing-panel")).toHaveTextContent("Usually around 60 seconds");
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    server.releaseAll();
    await waitFor(() => expect(headlineCard()).toHaveTextContent("2030-31"));
    expect(container.querySelector(".processing-panel")).toBeNull();
    // The breakdown stage: its cards wait with one message each
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    expect(container.querySelectorAll(".waiting-card")).toHaveLength(2);
    server.releaseAll();
    await screen.findByRole("heading", { name: /Change in net income by policy, 2030-31/ });
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
    expect(await screen.findByText(/Working out each policy's share/)).toBeInTheDocument();
    finishByPolicy();
    expect(await screen.findByRole("heading", { name: /Change in net income by policy/ })).toBeInTheDocument();
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

describe("keepSentence: the marginal rate as money", () => {
  it("keeps of the next £1,000, before and after, once when they round the same", () => {
    expect(keepSentence(0.62, 0.62)).toBe("Of your next £1,000 of earnings, you keep £380.");
    expect(keepSentence(0.62, 0.65)).toBe("Of your next £1,000 of earnings, you keep £380 before and keep £350 after.");
  });

  it("says a loss as a loss", () => {
    expect(keepSentence(1.05, 0.55)).toBe("Of your next £1,000 of earnings, you would lose £50 before and keep £450 after.");
  });

  it("turns to the next £100 at a cliff, where £1,000 would overstate it", () => {
    // Net income falls £2,140 over the next £100 before, £32 kept after
    expect(keepSentence(22.4, 0.68)).toBe("Of your next £100 of earnings, you would lose £2,140 before and keep £32 after.");
    expect(keepSentence(22.4, 22.4)).toBe("Of your next £100 of earnings, you would lose £2,140.");
  });

  it("is null without both rates", () => {
    expect(keepSentence(null, 0.4)).toBeNull();
    expect(keepSentence(0.4, undefined)).toBeNull();
  });
});

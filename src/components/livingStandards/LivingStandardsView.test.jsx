import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../../App";
import { dashboardFixtureFetch } from "../../test/dashboardFixture";

// The receipt fixture's supported year follows the engine's projection end;
// show Population impact in that verified year (as tabsSmoke.test.jsx does)
vi.mock("../../utils/displayYears", async (original) => {
  const actual = await original();
  const { IN_DATA } = await import("../../test/publicationFixture");
  return { ...actual, DEFAULT_DISPLAY_YEAR: IN_DATA, DISPLAY_YEARS: [...new Set([...actual.DISPLAY_YEARS, IN_DATA])] };
});

// A verified publication (the receipt fixture), so Population impact and
// its sub-tabs render (#104)
const publicationFetch = dashboardFixtureFetch();

const OUTLOOK = readFileSync(
  join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"),
  "utf8",
);

const PUBLIC = join(__dirname, "..", "..", "..", "public");

beforeEach(() => {
  // The outlook JSON, and the published CSVs so Population impact's
  // Living standards and Poverty sub-tabs (where the outlook's cards are)
  // render; an empty CSV for anything else
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (String(url).endsWith("living_standards_outlook.json")) {
        return new Response(OUTLOOK, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const { pathname } = new URL(String(url), "http://localhost");
      if (pathname === "/data/manifest.json" || pathname.startsWith("/data/artifacts/")) return publicationFetch(String(url), init);
      const path = join(PUBLIC, new URL(String(url), "http://localhost").pathname);
      return existsSync(path) && path.endsWith(".csv")
        ? new Response(readFileSync(path), { status: 200 })
        : new Response("reform_id,year,value\n", { status: 200 });
    }),
  );
  // A view: the bare address is the landing page, with no tab bar
  window.history.replaceState({}, "", "/?tab=dashboard");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (container) => container.querySelector(".title-row");

/**
 * Render the page and wait for the publication check: a verified snapshot
 * remounts the views (App.jsx), so elements are read after it.
 */
async function renderVerified() {
  const rendered = render(<App />);
  await waitFor(() => expect(rendered.container.querySelector('.app[data-publication="verified"]')).not.toBeNull());
  return rendered;
}

/**
 * Choose `option` for the choice `name` in `scope`: from its pill when it
 * has one, otherwise from the card's Options dialog (ControlBar), opened
 * if it is not open yet.
 */
function choose(scope, name, option) {
  const pill = within(scope).queryByRole("button", { name: new RegExp(`^${name}:`) });
  if (pill) {
    fireEvent.click(pill);
    fireEvent.click(within(scope).getByRole("option", { name: option }));
    return;
  }
  if (!within(scope).queryByRole("dialog")) {
    fireEvent.click(within(scope).getByRole("button", { name: /^Options:/ }));
  }
  const group = within(scope).getByRole("radiogroup", { name });
  fireEvent.click(within(group).getByRole("radio", { name: option }));
}

/** Open a card's Options popover, unless it is open already. */
function openOptions(card) {
  if (!within(card).queryByRole("dialog")) fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
}

/** A card's Options summary ("Absolute · Before housing costs · …"). */
const optionsSummary = (card) => within(card).getByRole("button", { name: /^Options:/, hidden: true }).getAttribute("aria-label");

describe("the Pre-measures forecast view", () => {
  it("is the third view tab, and choosing it shows the outlook", async () => {
    // A view's address: the bare one is the landing page, with no tab bar
    window.history.replaceState({}, "", "/?tab=dashboard");
    const { container } = await renderVerified();
    await screen.findByRole("tablist", { name: "Views" });
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toHaveAttribute("aria-hidden");
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[2]).toHaveTextContent("Pre-measures forecast");
    fireEvent.click(tabs[2]);

    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Pre-measures forecast" });
    // Its sub-tabs mirror Population impact's names: Living standards (the
    // default), Poverty, then Forecast changes
    const subTabs = within(screen.getByRole("tablist", { name: "Pre-measures forecast sections" })).getAllByRole("tab");
    expect(subTabs.map((t) => t.textContent)).toEqual(["Living standards", "Poverty", "Forecast changes"]);
    expect(subTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(await within(panel).findByRole("heading", { level: 2, name: "Living standards under current law" }, { timeout: 5000 })).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: /economic forecast$/ })).toBeNull();
    fireEvent.click(subTabs[2]);
    expect(await within(panel).findByRole("heading", { name: /economic forecast$/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook&sub=forecast");
    fireEvent.click(subTabs[0]);
    // Its engine and data are said in Methodology, not on this view
    expect(screen.queryByText(/policyengine 6\.8\.0/)).toBeNull();
    expect(screen.queryByText("Demo")).toBeNull();
    expect(window.location.search).toBe("?tab=outlook");
  });

  it("puts the current-law cards one a row on Living standards and Poverty", async () => {
    window.history.replaceState({}, "", "/?tab=outlook");
    await renderVerified();
    const living = await screen.findByRole("tabpanel", { name: "Living standards" });
    const card = (panel, name) => within(panel).getByRole("heading", { level: 3, name }).closest(".ls-card");
    // One heading, without the measures, linking to its twin with them
    const heading = await within(living).findByRole("heading", { level: 2, name: "Living standards under current law" }, { timeout: 5000 });
    const intro = heading.closest(".section-heading");
    expect(intro).toHaveTextContent(/^Living standards under current lawCurrent law, before any Budget measure\. See with the measures →$/);
    expect(within(intro).getByRole("link", { name: "See with the measures →" })).toHaveAttribute("href", "?tab=dashboard&sub=living");
    await within(living).findByRole("heading", { level: 3, name: /^Incomes over time$/ });
    const incomes = card(living, /^Incomes over time$/);
    // One card a row, full width: growth first, then incomes, then inequality
    const growthCard = card(living, /^Growth across the distribution$/);
    expect(growthCard.closest(".charts-grid").children).toHaveLength(1);
    expect(incomes.closest(".charts-grid").children).toHaveLength(1);
    expect(growthCard.compareDocumentPosition(incomes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Household income only: inequality is its own card
    expect(within(incomes).queryByRole("button", { name: /^Income view:/ })).toBeNull();
    expect(within(incomes).queryByRole("button", { name: /^Inequality measure:/ })).toBeNull();
    // Inequality over time: a row of its own, under the incomes pair
    const inequality = card(living, /^Inequality over time \(current law\)$/);
    expect(inequality.closest(".charts-grid")).not.toBe(incomes.closest(".charts-grid"));
    expect(inequality.closest(".charts-grid").children).toHaveLength(1);
    // No section-level years control: each card's Options holds its years
    expect(living.querySelector(".section-controls")).toBeNull();
    // Its measures named as on the measures' chart, in the same order
    fireEvent.click(within(inequality).getByRole("button", { name: /^Options:/ }));
    const measureGroup = within(inequality).getByRole("radiogroup", { name: "Inequality measure" });
    expect(within(measureGroup).getAllByRole("radio").map((o) => o.textContent)).toEqual(["Gini", "90/10 ratio"]);
    fireEvent.keyDown(within(inequality).getByRole("dialog"), { key: "Escape" });
    // One short line on the card; the basis and years in About this chart
    expect(inequality.querySelector(".chart-description").textContent).toMatch(/^Under current law, income inequality, measured by the Gini coefficient, (rises|falls|stays)/);
    expect(living.querySelectorAll(".ls-card")).toHaveLength(3);
    // Nothing with the measures here
    expect(living).not.toHaveTextContent(/With the selected measures/);
    expect(within(living).queryByRole("heading", { name: /^Change in income inequality/ })).toBeNull();

    const panel = () => living;
    for (const name of ["Child poverty", "What the baseline leaves out", "Data"]) {
      expect(screen.queryByRole("heading", { level: 2, name })).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "Two-child limit" })).toBeNull();
    // Nothing sits loose under a plot: no notes or source lines outside
    // "About this chart"
    expect(panel().querySelector(".ls-section > .note")).toBeNull();
    expect(panel().querySelectorAll(".ls-card-footer > :not(.disclosure)")).toHaveLength(0);
    expect(within(panel()).queryByText(/^2031-32 is past the OBR March 2026 forecast/)).toBeNull();
    expect(within(panel()).queryByText(/Source:/)).toBeNull();
    // The 2031-32 note is said once, in Methodology's "How the forecast
    // feeds the baseline": Incomes over time's About this chart links there,
    // its last line, after its source
    fireEvent.click(within(incomes).getByRole("button", { name: "About this chart" }));
    expect(within(incomes).queryByText(/is past the OBR March 2026 forecast/)).toBeNull();
    const about = incomes.querySelector(".disclosure-content");
    expect(within(about).getByRole("link", { name: "DWP, Households Below Average Income" })).toBeInTheDocument();
    expect(about.querySelector(".info-sections").lastElementChild).toHaveClass("info-method");
    expect(within(about).getByRole("link", { name: /How the OBR forecast feeds these incomes/ })).toHaveAttribute(
      "href",
      "?tab=methodology#method-forecast-feed",
    );
    expect(within(panel()).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();


    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    expect(window.location.search).toBe("?tab=outlook&sub=poverty");
    const poverty = screen.getByRole("tabpanel", { name: "Poverty" });
    const povertyHeading = await within(poverty).findByRole("heading", { name: "Poverty under current law" });
    expect(povertyHeading.closest(".section-heading")).toHaveTextContent(/Current law, before any Budget measure\./);
    expect(within(poverty).getByRole("link", { name: "See with the measures →" })).toHaveAttribute("href", "?tab=dashboard&sub=poverty");
    await within(poverty).findByRole("heading", { level: 3, name: /^Poverty over time$/ });
    // One card a row, both on the same measure at first, under the age
    // groups' tiles
    const overTime = card(poverty, /^Poverty over time$/);
    const who = card(poverty, /^Who is in poverty$/);
    expect(overTime.closest(".charts-grid")).not.toBe(who.closest(".charts-grid"));
    expect(overTime.closest(".charts-grid").children).toHaveLength(1);
    for (const c of [overTime, who]) {
      expect(c.querySelector(".control-bar-summary")).toHaveTextContent(/Absolute · Before housing costs/);
    }
    expect(poverty.querySelectorAll(".poverty-tiles .forecast-tile")).toHaveLength(3);
    // The two current-law cards only: Which measures move poverty is on
    // Population impact
    expect(poverty.querySelectorAll(".ls-card")).toHaveLength(2);
  });

  it.each([
    ["living", "Living standards", "Living standards under current law", [/^Incomes over time$/, /^Growth across the distribution$/, /^Inequality over time/]],
    ["poverty", "Poverty", "Poverty under current law", [/^Poverty over time$/, /^Who is in poverty$/]],
  ])("?tab=outlook&sub=%s shows the current-law cards with no policy selected", async (sub, label, heading, cards) => {
    // A link whose policies are all unknown selects none: current law needs none
    window.history.replaceState({}, "", `/?tab=outlook&sub=${sub}&policies=not_a_measure`);
    await renderVerified();
    const panel = await screen.findByRole("tabpanel", { name: label });
    expect(await within(panel).findByRole("heading", { level: 2, name: heading }, { timeout: 5000 })).toBeInTheDocument();
    for (const name of cards) {
      expect(await within(panel).findByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(within(panel).queryByText(/^Select policies to analyse/)).toBeNull();
    expect(panel).not.toHaveTextContent(/With the selected measures/);
  });

  it.each([
    ["living", "Living standards", "Inequality"],
    ["poverty", "Poverty", "How the measures change poverty"],
  ])("Population impact's %s shows only the measures, linking to its twin without them", async (sub, label, measures) => {
    window.history.replaceState({}, "", `/?sub=${sub}`);
    await renderVerified();
    const panel = await screen.findByRole("tabpanel", { name: label });
    const heading = await within(panel).findByRole("heading", { level: 2, name: measures }, { timeout: 5000 });
    expect(heading.closest(".section-heading")).toHaveTextContent(/With the selected measures[.:,]/);
    const link = within(panel).getByRole("link", { name: "See without them →" });
    expect(link).toHaveAttribute("href", `?tab=outlook&sub=${sub}`);
    // No current-law card here
    expect(within(panel).queryByRole("heading", { name: /under current law|^Inequality over time|^Incomes over time$|^Poverty over time$/ })).toBeNull();
    // (Living standards' growth card with the measures links to its twin
    // as "Without the measures"; no current-law card says it is one)
    expect(panel).not.toHaveTextContent(/Without the measures \(current law\)|Without the measures:/);
    // The link opens the twin in place, the address following
    fireEvent.click(link);
    expect(screen.getByRole("tab", { name: "Pre-measures forecast" })).toHaveAttribute("aria-selected", "true");
    const twin = screen.getByRole("tabpanel", { name: label });
    expect(twin).not.toBe(panel);
    expect(await within(twin).findByRole("heading", { level: 2, name: `${label} under current law` }, { timeout: 5000 })).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect([params.get("tab"), params.get("sub")]).toEqual(["outlook", sub === "living" ? null : sub]);
    // And back
    fireEvent.click(within(twin).getByRole("link", { name: "See with the measures →" }));
    expect(screen.getByRole("tab", { name: "Population impact" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: label })).toBe(panel);
    expect(new URLSearchParams(window.location.search).get("sub")).toBe(sub);
  });

  it("opens every card with Years compared on 2027-28 → 2031-32 when the address names no years", async () => {
    window.history.replaceState({}, "", "/?tab=outlook");
    await renderVerified();
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re }, { timeout: 5000 });
    const cards = [];
    for (const re of [/^Growth across the distribution/, /^Incomes over time/, /^Inequality over time/]) {
      cards.push((await heading(re)).closest(".ls-card"));
    }
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    for (const re of [/^Poverty over time/, /^Who is in poverty/]) {
      cards.push((await heading(re)).closest(".ls-card"));
    }
    for (const card of cards) {
      expect(optionsSummary(card)).toMatch(/^Options: 2027-28 → 2031-32 · /);
    }
    // Nothing chosen, so nothing in the address
    const params = new URLSearchParams(window.location.search);
    expect([params.get("ls_from"), params.get("ls_to")]).toEqual([null, null]);
  });

  it("compares the years chosen in each card's Options pill, shared by every card", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&ls_from=2028&ls_to=2030");
    await renderVerified();
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re }, { timeout: 5000 });
    const incomes = (await heading(/^Incomes over time/)).closest(".ls-card");
    const inequality = (await heading(/^Inequality over time/)).closest(".ls-card");
    const growth = (await heading(/^Growth across the distribution/)).closest(".ls-card");
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    const poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    const who = (await heading(/^Who is in poverty/)).closest(".ls-card");
    // The years lead every card's one Options pill
    for (const card of [incomes, inequality, growth, poverty, who]) {
      expect(optionsSummary(card)).toMatch(/^Options: 2028-29 → 2030-31 · /);
    }
    expect(optionsSummary(incomes)).toBe("Options: 2028-29 → 2030-31 · Median · Before housing costs · Real · Outturn and projection");
    for (const card of [incomes, inequality, poverty]) {
      // The sentence compares the chosen years
      expect(card).toHaveTextContent(/2028-29/);
      expect(card).toHaveTextContent(/2030-31/);
      expect(card.querySelector(".ls-summary, p")).not.toHaveTextContent(/from 2027-28 to 2031-32/);
    }
    // Chosen in one card's popover, followed by the others and the address
    openOptions(poverty);
    fireEvent.click(within(within(poverty).getByRole("radiogroup", { name: "From" })).getByRole("radio", { name: "2029-30" }));
    expect(new URLSearchParams(window.location.search).get("ls_from")).toBe("2029");
    expect(optionsSummary(who)).toMatch(/^Options: 2029-30 → 2030-31 · /);
    expect(optionsSummary(incomes)).toMatch(/^Options: 2029-30 → 2030-31 · /);
  });

  it("switches each card's view with its switch, and never shows a signed zero", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=poverty");
    await renderVerified();
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re }, { timeout: 5000 });

    // Poverty over time: Rate (its Poverty line, Housing costs, People and
    // Period under one Options button, worded as on Population impact) or Depth
    let poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    // One Options pill: the view first ("Show": Rate or Depth), then the
    // same default as Population impact: absolute, before housing costs, all people
    expect(within(poverty).queryByRole("button", { name: /^Poverty view:/ })).toBeNull();
    expect(optionsSummary(poverty)).toBe("Options: 2027-28 → 2031-32 · Rate · Absolute · Before housing costs · All people · Outturn and projection");
    // The Options dialog: a radio group per choice, focus inside, Escape closes
    const optionsButton = within(poverty).getByRole("button", { name: /^Options:/ });
    expect(optionsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(optionsButton);
    expect(optionsButton).toHaveAttribute("aria-expanded", "true");
    const dialog = within(poverty).getByRole("dialog", { name: "Poverty over time options" });
    expect(within(dialog).getAllByRole("radiogroup").map((g) => g.textContent.length > 0)).toHaveLength(7);
    expect(within(dialog).getByRole("group", { name: "Years compared" })).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(within(poverty).queryByRole("dialog")).toBeNull();
    expect(optionsButton).toHaveFocus();
    choose(poverty, "People", "Children");
    expect(optionsSummary(poverty)).toMatch(/· Children ·/);
    choose(poverty, "People", "All people");
    fireEvent.keyDown(within(poverty).getByRole("dialog"), { key: "Escape" });
    choose(poverty, "Show", "Depth");
    poverty = (await heading(/^Poverty over time$/)).closest(".ls-card");
    // Depth has no choices of its own: the pill holds the view alone
    expect(optionsSummary(poverty)).toBe("Options: Depth");
    fireEvent.keyDown(within(poverty).getByRole("dialog"), { key: "Escape" });
    expect(poverty.querySelector(".chart-description").textContent).toMatch(/^Under current law, [\d.]+% of people are in very deep poverty in \d{4}-\d{2}, /);

    // Who is in poverty: a bar per group for the end year with a tick at the
    // start year, for every breakdown, with its reference group
    const who = (await heading(/^Who is in poverty/)).closest(".ls-card");
    // One short line on the card; the full sentence in About this chart
    expect(who.querySelector(".chart-description").textContent).toMatch(/^Under current law, [a-z].* have the highest .*: \d+\.\d% in \d{4}-\d{2}/);
    fireEvent.click(within(who).getByRole("button", { name: "About this chart" }));
    // It opens on Poverty over time's measure; relative after housing costs
    // from here
    expect(optionsSummary(who)).toMatch(/· Absolute · Before housing costs$/);
    choose(who, "Poverty line", "Relative");
    fireEvent.keyDown(within(who).getByRole("dialog"), { key: "Escape" });
    const couplesRow = () => within(who).getByRole("rowheader", { name: "Couples with children" }).closest(".ls-bar-row");
    // Couples with children, relative before housing costs: 14.5% in both
    // years, said once on the bar
    let couples = couplesRow();
    expect(couples).toHaveTextContent("Couples with children14.5%no change");
    expect(couples.querySelector(".ls-bar-start")).not.toBeNull();
    // Its tooltip, on hover or keyboard focus: both years, the change and
    // the reference group
    let area = couples.querySelector(".ls-bar-area");
    fireEvent.focus(area);
    let tip = within(who).getByRole("tooltip");
    expect(tip).toHaveTextContent("Couples with children: relative poverty (BHC)");
    expect(tip).toHaveTextContent("2027-2814.5%");
    expect(tip).toHaveTextContent("ChangeNo change");
    expect(tip).toHaveTextContent(/All people, \d{4}-\d{2}/);
    fireEvent.blur(area);
    expect(within(who).queryByRole("tooltip")).toBeNull();
    // After housing costs, from here: 20.1% in 2027-28, 20.5% in 2031-32
    choose(who, "Housing costs", "After housing costs");
    fireEvent.keyDown(within(who).getByRole("dialog"), { key: "Escape" });
    couples = couplesRow();
    expect(couples).toHaveTextContent("Couples with children20.5%+0.4pp");
    area = couples.querySelector(".ls-bar-area");
    fireEvent.focus(area);
    tip = within(who).getByRole("tooltip");
    expect(tip).toHaveTextContent("Couples with children: relative poverty (AHC)");
    expect(tip).toHaveTextContent("2027-2820.1%");
    expect(tip).toHaveTextContent("Change+0.4pp");
    fireEvent.blur(area);
    expect(within(who).getByText(/^All people/)).toBeInTheDocument();
    for (const option of ["Tenure", "Children by number of children", "Children: lone parent vs couple"]) {
      choose(who, "Breakdown", option);
      expect(who.querySelector(".ls-bars")).not.toBeNull();
    }
    expect(within(who).getByText(/^All children/)).toBeInTheDocument();
    // Children's breakdowns are after housing costs only: Before is listed, disabled
    expect(optionsSummary(who)).toMatch(/· After housing costs$/);
    choose(who, "Poverty line", "Absolute");
    expect(within(who).getByRole("radio", { name: "Before housing costs" })).toBeDisabled();
    expect(within(who).getByText(/absolute child poverty rate/)).toBeInTheDocument();

    // On Living standards: Inequality over time and Growth across the distribution
    fireEvent.click(screen.getByRole("tab", { name: "Living standards" }));
    const inequality = (await heading(/^Inequality over time/)).closest(".ls-card");
    choose(inequality, "Inequality measure", "90/10 ratio");
    expect(inequality.querySelector(".chart-description").textContent).toMatch(/^Under current law, the gap between top and bottom incomes \(90:10 ratio\) (rises|falls|stays)/);
    const growth = (await heading(/^Growth across the distribution/)).closest(".ls-card");
    // Year by year and vigintiles by default (Vahid, 26 October): one short
    // line, from the second-lowest twentieth (vigintile 1 left out)
    const headline = () => growth.querySelector(".chart-description").textContent;
    expect(headline()).toMatch(/^Under current law, real incomes (grow|fall|barely) .+ \(\S+% a year at the bottom, \S+% at the top\)\.$/);
    // The full sentence and the vigintile note are in About this chart
    expect(within(growth).queryByText(/^The lowest-income 5% are left out/)).toBeNull();
    fireEvent.click(within(growth).getByRole("button", { name: "About this chart" }));
    expect(within(growth).getByText(/The lowest-income twentieth is left out/)).toBeInTheDocument();
    expect(within(growth).getByText(/re-ranked each year/)).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("ls_groups")).toBe(false);
    // One Options pill, the view first: no separate View pill
    expect(within(growth).queryByRole("button", { name: /^Growth view:/ })).toBeNull();
    expect(optionsSummary(growth)).toBe("Options: 2027-28 → 2031-32 · Year by year · Twentieths · Before housing costs · All people");
    expect(within(growth).queryByRole("button", { name: /^Distribution view/ })).not.toBeInTheDocument();
    expect(within(growth).queryByText(/tenth|fifth/)).not.toBeInTheDocument();
    expect(within(growth).queryByText(/^The lowest-income tenth after housing costs/)).toBeNull();
    // Year by year, deciles, after housing costs, non-pensioners: each
    // choice in the address, the sentence following
    choose(growth, "View", "Year by year");
    choose(growth, "Income groups", "Tenths");
    choose(growth, "Housing costs", "After housing costs");
    choose(growth, "Population", "Non-pensioners");
    const chosen = new URLSearchParams(window.location.search);
    expect([chosen.get("ls_growth"), chosen.get("ls_groups"), chosen.get("ls_housing"), chosen.get("ls_pop")]).toEqual([
      null,
      "decile",
      "ahc",
      "non_pensioners",
    ]);
    expect(within(growth).getByText("Bottom is the lowest-income tenth; top the highest-income tenth among non-pensioners.")).toBeInTheDocument();
    expect(within(growth).getByText(/^Each year from 2028-29 to 2031-32/)).toBeInTheDocument();
    expect(within(growth).getByText("Highest income")).toBeInTheDocument();
    // Decile 1 after housing costs: kept, with a short caution under the
    // key, said once (not again in About this chart)
    expect(within(growth).getByText(/^The lowest-income tenth after housing costs swings from year to year/)).toBeInTheDocument();
    expect(within(growth).getAllByText(/swings from year to year/)).toHaveLength(1);
    // Vigintiles clear the household floor, so they are offered
    choose(growth, "Income groups", "Twentieths");
    // Vigintile 1, the lowest-income 5%, is left out: the sentence starts at
    // the second-lowest twentieth, the key at vigintile 2, the note in About
    expect(within(growth).getByText("Lowest income")).toBeInTheDocument();
    expect(within(growth).getByText(/^Bottom is the second-lowest-income twentieth/)).toBeInTheDocument();
    expect(within(growth).queryByText(/in the lowest-income twentieth/)).toBeNull();
    expect(within(growth).getByText("Lowest income")).toBeInTheDocument();
    expect(within(growth).queryByText(/^Vigintile/)).toBeNull();
    expect(within(growth).queryByText(/^The lowest-income tenth after housing costs/)).toBeNull();
    // Deciles and quintiles keep their bottom group; only deciles after
    // housing costs carry the caution
    choose(growth, "Income groups", "Tenths");
    expect(within(growth).getByText(/^The lowest-income tenth after housing costs/)).toBeInTheDocument();
    choose(growth, "Income groups", "Fifths");
    expect(within(growth).getByText(/^1st fifth \(lowest income\)/)).toBeInTheDocument();
    expect(within(growth).getAllByText(/lowest-income fifth/).length).toBeGreaterThan(0);
    expect(within(growth).queryByText(/^The lowest-income tenth after housing costs/)).toBeNull();
    expect(new URLSearchParams(window.location.search).get("ls_groups")).toBe("quintile");
    // Back to vigintiles, the default, leaves ?ls_groups out
    choose(growth, "Income groups", "Twentieths");
    // Whole period goes in the address; back to the defaults leaves nothing
    choose(growth, "View", "Whole period");
    expect(new URLSearchParams(window.location.search).get("ls_growth")).toBe("period");
    choose(growth, "View", "Year by year");
    choose(growth, "Housing costs", "Before housing costs");
    choose(growth, "Population", "All people");
    for (const param of ["ls_growth", "ls_groups", "ls_housing", "ls_pop"]) {
      expect(new URLSearchParams(window.location.search).has(param)).toBe(false);
    }

    // The two years compared: chosen in one card, kept in the address and
    // followed by every card comparing two years, on either sub-tab
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    // Chosen in one card's Options popover
    openOptions(who);
    fireEvent.click(within(within(who).getByRole("radiogroup", { name: "From" })).getByRole("radio", { name: "2029-30" }));
    expect(new URLSearchParams(window.location.search).get("ls_from")).toBe("2029");
    // Titles carry no years (the pill, axes and sentence do): the sentences follow
    expect(await heading(/^Who is in poverty$/)).toBeInTheDocument();
    expect(who.querySelector(".chart-description").textContent).toMatch(/since 2029-30|the same as in 2029-30/);
    expect(within(growth).getByText(/Each year from 2030-31 to 2031-32/)).toBeInTheDocument();

    // A change that rounds to zero reads "no change", never "−0.0pp" or "0.0%"
    expect(document.body.textContent).not.toMatch(/[−-]0\.0(pp|%)/);
    expect(document.body.textContent).not.toMatch(/(rises|falls) 0\.0/);
  });

  it("opens Forecast changes for an old Forecast changes link", async () => {
    // An old link (?tab=living): the view at its new address, ?sub= kept
    window.history.replaceState({}, "", "/?tab=living&sub=forecast");
    await renderVerified();
    const panel = await screen.findByRole("tabpanel", { name: "Forecast changes" });
    expect(await within(panel).findByRole("heading", { name: /economic forecast$/ })).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect([params.get("tab"), params.get("sub")]).toEqual(["outlook", "forecast"]);
    // The OBR's household income per person card is gone
    expect(within(panel).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();
    expect(within(panel).queryByText(/disposable income per person/)).toBeNull();
    expect(screen.queryByText(/^Projections of UK household incomes and poverty/)).toBeNull();
  });

  it.each([["/?tab=outlook&sub=nonsense"], ["/?tab=living"], ["/?tab=outlook"]])(
    "opens Living standards for %s, with no ?sub=",
    async (address) => {
      window.history.replaceState({}, "", address);
      await renderVerified();
      const panel = await screen.findByRole("tabpanel", { name: "Living standards" });
      expect(await within(panel).findByRole("heading", { name: "Living standards under current law" }, { timeout: 5000 })).toBeInTheDocument();
      expect(window.location.search).toBe("?tab=outlook");
    },
  );

  it("opens its Living standards for an old Baseline outlook link", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=baseline&ls_from=2028");
    await renderVerified();
    expect(screen.getByRole("tab", { name: "Pre-measures forecast" })).toHaveAttribute("aria-selected", "true");
    const living = await screen.findByRole("tabpanel", { name: "Living standards" });
    expect(await within(living).findByRole("heading", { name: "Living standards under current law" }, { timeout: 5000 })).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("outlook");
    expect(params.has("sub")).toBe(false);
    // The cards' own choices carry over
    expect(params.get("ls_from")).toBe("2028");
  });

  it("states its engine, data, status, notes and gaps once, in Methodology", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    await renderVerified();
    const section = await screen.findByRole("region", { name: "Pre-measures forecast" });
    // The engine's two packages, each linked to its release
    expect(await within(section).findByRole("link", { name: /^policyengine 6\.11\.1/ })).toHaveAttribute(
      "href",
      "https://github.com/PolicyEngine/policyengine.py/releases/tag/6.11.1",
    );
    expect(within(section).getByRole("link", { name: /^policyengine-uk 2\.151\.0/ })).toHaveAttribute(
      "href",
      "https://github.com/PolicyEngine/policyengine-uk/releases/tag/2.151.0",
    );
    expect(within(section).getByText("Microcosm UK national, 25 Oct 2026 (a6299504)")).toBeInTheDocument();
    expect(within(section).getByText("Unvalidated")).toBeInTheDocument();
    expect(within(section).getByText(/2027-28 prices/)).toBeInTheDocument();
    expect(within(section).getByText("2027-28 to 2031-32")).toBeInTheDocument();
    // No UC health element row: from policyengine-uk 2.134.4 the engine has
    // the fix, so the baseline no longer applies it (FIXED_IN)
    expect(within(section).queryByRole("link", { name: /^policyengine-uk #2428/ })).toBeNull();
    expect(within(section).queryByText(/Patched for 2030-31 and 2031-32/)).toBeNull();
    expect(within(section).getByRole("heading", { level: 3, name: "What the baseline leaves out" })).toBeInTheDocument();
    expect(document.body.textContent.match(/unvalidated/gi)).toHaveLength(1);
  });

  it("keeps the year and policy pills in the band, faded and inactive, as they do not change it", async () => {
    window.history.replaceState({}, "", "/?tab=outlook");
    const { container } = render(<App />);
    await screen.findByRole("tablist", { name: "Views" });
    for (const selector of [".band-year", ".band-policy"]) {
      const pill = band(container).querySelector(selector);
      // Still in the band and visible, so the band never moves; faded, and
      // its button says it does not change this tab
      expect(pill).not.toHaveClass("is-hidden");
      expect(pill).not.toHaveAttribute("aria-hidden");
      expect(pill).not.toHaveAttribute("inert");
      expect(pill).toHaveClass("is-inactive");
      expect(pill.querySelector(".band-control")).toHaveAttribute("aria-disabled", "true");
      expect(pill.querySelector(".band-control").getAttribute("aria-label")).toMatch(/change this tab/);
    }
    expect(screen.getByRole("tab", { name: "Pre-measures forecast" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

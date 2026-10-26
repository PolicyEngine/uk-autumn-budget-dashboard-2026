import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../App";

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
    vi.fn(async (url) => {
      if (String(url).endsWith("living_standards_outlook.json")) {
        return new Response(OUTLOOK, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const path = join(PUBLIC, new URL(String(url), "http://localhost").pathname);
      return existsSync(path) && path.endsWith(".csv")
        ? new Response(readFileSync(path), { status: 200 })
        : new Response("reform_id,year,value\n", { status: 200 });
    }),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (container) => container.querySelector(".title-row");

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

/** A card's Options summary ("Absolute · Before housing costs · …"). */
const optionsSummary = (card) => within(card).getByRole("button", { name: /^Options:/ }).getAttribute("aria-label");

describe("the Pre-measures forecast view", () => {
  it("is the third view tab, and choosing it shows the outlook", async () => {
    const { container } = render(<App />);
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toHaveAttribute("aria-hidden");
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[2]).toHaveTextContent("Pre-measures forecast");
    fireEvent.click(tabs[2]);

    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Pre-measures forecast" });
    // The OBR forecast only: no sub-tabs, and the current-law cards are on
    // Population impact
    expect(await within(panel).findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Pre-measures forecast sections" })).toBeNull();
    for (const name of ["Incomes under current law", "Poverty under current law"]) {
      expect(within(panel).queryByRole("heading", { name })).toBeNull();
    }
    expect(within(panel).queryByRole("heading", { level: 3, name: /^Incomes over time$/ })).toBeNull();
    // Its engine and data are said in Methodology, not on this view
    expect(screen.queryByText(/policyengine 6\.8\.0/)).toBeNull();
    expect(screen.queryByText("Demo")).toBeNull();
    expect(window.location.search).toBe("?tab=outlook");
  });

  it("puts the current-law cards on Living standards and Poverty, in rows of two", async () => {
    window.history.replaceState({}, "", "/?sub=living");
    render(<App />);
    const living = await screen.findByRole("tabpanel", { name: "Living standards" });
    const card = (panel, name) => within(panel).getByRole("heading", { level: 3, name }).closest(".ls-card");
    // How the measures change incomes, then incomes under current law, then
    // inequality: the measures' effect beside its level under current law
    const order = ["How the measures change incomes", "Incomes under current law", "Inequality"];
    const headings = await Promise.all(order.map((name) => within(living).findByRole("heading", { level: 2, name }, { timeout: 5000 })));
    for (let i = 1; i < headings.length; i += 1) {
      expect(headings[i - 1].compareDocumentPosition(headings[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const incomes = card(living, /^Incomes over time$/);
    expect(incomes.closest(".charts-grid")).toBe(card(living, /^Growth across the distribution$/).closest(".charts-grid"));
    // Household income only: inequality is its own card
    expect(within(incomes).queryByRole("button", { name: /^Income view:/ })).toBeNull();
    expect(within(incomes).queryByRole("button", { name: /^Inequality measure:/ })).toBeNull();
    const inequality = card(living, /^Inequality over time \(current law\)$/);
    expect(inequality.closest("#inequality")).not.toBeNull();
    expect(inequality.closest(".charts-grid")).toBe(
      within(living).getByRole("heading", { level: 3, name: /^Change in income inequality/ }).closest(".charts-grid"),
    );
    // Its measures named as on the measures' chart, in the same order
    fireEvent.click(within(inequality).getByRole("button", { name: /^Inequality measure:/ }));
    expect(within(inequality).getAllByRole("option").map((o) => o.textContent.replace(/^✓/, ""))).toEqual(["Gini", "90/10 ratio"]);
    expect(within(inequality).getByText(/^The Gini \(BHC\)/)).toBeInTheDocument();
    expect(living.querySelectorAll(".ls-card")).toHaveLength(3);

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
    // The series note is stated once, in Incomes over time's About this
    // chart, after the definition and notes, with the source line last
    fireEvent.click(within(incomes).getByRole("button", { name: "About this chart" }));
    expect(within(incomes).getByText(/^2031-32 is past the OBR March 2026 forecast/)).toBeInTheDocument();
    expect(document.body.textContent.match(/is past the OBR March 2026 forecast/g)).toHaveLength(1);
    const about = incomes.querySelector(".disclosure-content");
    expect(about.lastElementChild).toHaveClass("ls-source");
    expect(about.lastElementChild).toHaveTextContent(/^Source: DWP, Households Below Average Income/);
    expect(within(panel()).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();


    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    const poverty = screen.getByRole("tabpanel", { name: "Poverty" });
    await within(poverty).findByRole("heading", { name: "Poverty under current law" });
    expect(card(poverty, /^Poverty over time$/).closest(".charts-grid")).toBe(card(poverty, /^Who is in poverty$/).closest(".charts-grid"));
    // The two current-law cards, and Which measures move poverty (an ls-card)
    expect(poverty.querySelectorAll(".ls-card")).toHaveLength(3);
  });

  it.each([
    ["living", "Living standards", "How the measures change incomes", ["Incomes under current law", "Inequality"], [/^Incomes over time$/, /^Growth across the distribution$/, /^Inequality over time/]],
    ["poverty", "Poverty", "How the measures change poverty", ["Poverty under current law"], [/^Poverty over time$/, /^Who is in poverty$/]],
  ])("?sub=%s shows the current-law cards with no policy selected", async (sub, label, measures, headings, cards) => {
    // A link whose policies are all unknown selects none
    window.history.replaceState({}, "", `/?sub=${sub}&policies=not_a_measure`);
    render(<App />);
    const panel = await screen.findByRole("tabpanel", { name: label });
    // The measures' sections give way to the empty state, alone
    expect(await within(panel).findByText(/^Select policies to analyse/)).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: measures })).toBeNull();
    expect(within(panel).queryByRole("heading", { name: /^Change in (income inequality|the poverty rate)/ })).toBeNull();
    for (const name of headings) {
      expect(await within(panel).findByRole("heading", { level: 2, name }, { timeout: 5000 })).toBeInTheDocument();
    }
    for (const name of cards) {
      expect(await within(panel).findByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(panel).not.toHaveTextContent(/With the selected measures/);
  });

  it("compares the years chosen in the range pill on Incomes and Poverty over time", async () => {
    window.history.replaceState({}, "", "/?sub=living&ls_from=2028&ls_to=2030");
    render(<App />);
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re }, { timeout: 5000 });
    const incomes = (await heading(/^Incomes over time/)).closest(".ls-card");
    const inequality = (await heading(/^Inequality over time/)).closest(".ls-card");
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    const poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    // The section's range pill (Incomes, Poverty) and the Inequality card's
    // show the chosen years
    for (const scope of [incomes.closest("[role=tabpanel]"), inequality, poverty.closest("[role=tabpanel]")]) {
      expect(within(scope).getAllByRole("group", { name: "Years compared", hidden: true })[0]).toHaveTextContent(/2028-29.*2030-31/);
    }
    // Incomes and Poverty over time have none of their own
    expect(within(incomes).queryByRole("group", { name: "Years compared", hidden: true })).toBeNull();
    expect(within(poverty).queryByRole("group", { name: "Years compared", hidden: true })).toBeNull();
    for (const card of [incomes, inequality, poverty]) {
      // The sentence compares the chosen years
      expect(card).toHaveTextContent(/2028-29/);
      expect(card).toHaveTextContent(/2030-31/);
      expect(card.querySelector(".ls-summary, p")).not.toHaveTextContent(/from 2027-28 to 2031-32/);
    }
  });

  it("switches each card's view with its switch, and never shows a signed zero", async () => {
    window.history.replaceState({}, "", "/?sub=poverty");
    render(<App />);
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re }, { timeout: 5000 });

    // Poverty over time: Rate (its Poverty line, Housing costs, People and
    // Period under one Options button, worded as on Population impact) or Depth
    let poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    // The view is a "Show" pill (Rate or Depth); one row of controls
    expect(within(poverty).getByRole("button", { name: /^Poverty view:/ })).toHaveTextContent("Rate");
    // The same default as Population impact: absolute, before housing costs, all people
    expect(optionsSummary(poverty)).toBe("Options: Absolute · Before housing costs · All people · Outturn and projection");
    // The Options dialog: a radio group per choice, focus inside, Escape closes
    const optionsButton = within(poverty).getByRole("button", { name: /^Options:/ });
    expect(optionsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(optionsButton);
    expect(optionsButton).toHaveAttribute("aria-expanded", "true");
    const dialog = within(poverty).getByRole("dialog", { name: "Poverty over time options" });
    expect(within(dialog).getAllByRole("radiogroup").map((g) => g.textContent.length > 0)).toHaveLength(4);
    expect(dialog).toContainElement(document.activeElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(within(poverty).queryByRole("dialog")).toBeNull();
    expect(optionsButton).toHaveFocus();
    choose(poverty, "People", "Children");
    expect(optionsSummary(poverty)).toMatch(/· Children ·/);
    choose(poverty, "People", "All people");
    fireEvent.keyDown(within(poverty).getByRole("dialog"), { key: "Escape" });
    choose(poverty, "Poverty view", "Depth");
    poverty = (await heading(/^Poverty over time$/)).closest(".ls-card");
    expect(within(poverty).queryByRole("button", { name: /^Options:/ })).toBeNull();
    expect(within(poverty).getByText(/very deep poverty/)).toBeInTheDocument();

    // Who is in poverty: a bar per group for the end year with a tick at the
    // start year, for every breakdown, with its reference group
    const who = (await heading(/^Who is in poverty/)).closest(".ls-card");
    // Couples with children: 19.8% in both years, said once on the bar
    const couples = within(who).getByRole("rowheader", { name: "Couples with children" }).closest(".ls-bar-row");
    expect(couples).toHaveTextContent("Couples with children19.8%no change");
    expect(couples.querySelector(".ls-bar-start")).not.toBeNull();
    // Its tooltip, on hover or keyboard focus: both years, the change and
    // the reference group
    const area = couples.querySelector(".ls-bar-area");
    fireEvent.focus(area);
    const tip = within(who).getByRole("tooltip");
    expect(tip).toHaveTextContent("Couples with children: relative poverty (AHC)");
    expect(tip).toHaveTextContent("2027-2819.8%");
    expect(tip).toHaveTextContent("ChangeNo change");
    expect(tip).toHaveTextContent(/All people, \d{4}-\d{2}/);
    fireEvent.blur(area);
    expect(within(who).queryByRole("tooltip")).toBeNull();
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
    expect(within(inequality).getByText(/^The 90\/10 ratio \(BHC\)/)).toBeInTheDocument();
    const growth = (await heading(/^Growth across the distribution/)).closest(".ls-card");
    // Year by year by default (Vahid, 26 October): quintiles, the sentence by fifths
    expect(within(growth).getByText(/lowest-income fifth/)).toBeInTheDocument();
    expect(within(growth).getByRole("button", { name: /^Growth view:/ })).toHaveTextContent("Year by year");
    expect(within(growth).queryByRole("button", { name: /^Distribution view/ })).not.toBeInTheDocument();
    expect(within(growth).queryByText(/tenth/)).not.toBeInTheDocument();
    // Year by year, deciles, after housing costs, non-pensioners: each
    // choice in the address, the sentence following
    choose(growth, "Growth view", "Year by year");
    choose(growth, "Income groups", "Deciles");
    choose(growth, "Housing costs", "After housing costs");
    choose(growth, "Population", "Non-pensioners");
    const chosen = new URLSearchParams(window.location.search);
    expect([chosen.get("ls_growth"), chosen.get("ls_groups"), chosen.get("ls_housing"), chosen.get("ls_pop")]).toEqual([
      null,
      "decile",
      "ahc",
      "non_pensioners",
    ]);
    expect(within(growth).getByText(/^Each year from 2028-29 to 2031-32, real median income \(AHC\) among non-pensioners/)).toBeInTheDocument();
    expect(within(growth).getByText(/lowest-income tenth/)).toBeInTheDocument();
    // Vigintiles clear the household floor, so they are offered
    choose(growth, "Income groups", "Vigintiles");
    // Vigintile 1, the lowest-income 5%, is left out: the sentence starts at
    // the second-lowest twentieth, the key at vigintile 2, with a note
    expect(within(growth).getByText(/second-lowest-income twentieth \(5th–10th percentile\)/)).toBeInTheDocument();
    expect(within(growth).queryByText(/in the lowest-income twentieth/)).toBeNull();
    expect(within(growth).getByText(/^Vigintile 2 \(lowest shown/)).toBeInTheDocument();
    expect(within(growth).queryByText(/^Vigintile 1\b/)).toBeNull();
    expect(within(growth).getByText(/^The lowest-income 5% are left out/)).toBeInTheDocument();
    // Deciles keep their bottom group, with no note
    choose(growth, "Income groups", "Deciles");
    expect(within(growth).queryByText(/^The lowest-income 5% are left out/)).toBeNull();
    choose(growth, "Income groups", "Vigintiles");
    // Whole period goes in the address; back to the defaults leaves nothing
    choose(growth, "Growth view", "Whole period");
    expect(new URLSearchParams(window.location.search).get("ls_growth")).toBe("period");
    choose(growth, "Growth view", "Year by year");
    choose(growth, "Income groups", "Quintiles");
    choose(growth, "Housing costs", "Before housing costs");
    choose(growth, "Population", "All people");
    for (const param of ["ls_growth", "ls_groups", "ls_housing", "ls_pop"]) {
      expect(new URLSearchParams(window.location.search).has(param)).toBe(false);
    }

    // The two years compared: chosen in one card, kept in the address and
    // followed by every card comparing two years, on either sub-tab
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    // Chosen once for the section, above its cards
    choose(screen.getByRole("tabpanel", { name: "Poverty" }), "Compare from", "2029-30");
    expect(new URLSearchParams(window.location.search).get("ls_from")).toBe("2029");
    // Titles carry no years (the pill, axes and sentence do): the sentences follow
    expect(await heading(/^Who is in poverty$/)).toBeInTheDocument();
    expect(within(who).getByText(/since 2029-30/)).toBeInTheDocument();
    expect(within(growth).getByText(/^Each year from 2030-31 to 2031-32/)).toBeInTheDocument();

    // A change that rounds to zero reads "no change", never "−0.0pp" or "0.0%"
    expect(document.body.textContent).not.toMatch(/[−-]0\.0(pp|%)/);
    expect(document.body.textContent).not.toMatch(/(rises|falls) 0\.0/);
  });

  it("opens the view for an old Forecast changes link, its ?sub= dropped", async () => {
    // An old link (?tab=living): the view at its new address
    window.history.replaceState({}, "", "/?tab=living&sub=forecast");
    render(<App />);
    const panel = await screen.findByRole("tabpanel", { name: "Pre-measures forecast" });
    expect(await within(panel).findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook");
    // The OBR's household income per person card is gone
    expect(within(panel).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();
    expect(within(panel).queryByText(/disposable income per person/)).toBeNull();
    expect(screen.queryByText(/^Projections of UK household incomes and poverty/)).toBeNull();
  });

  it("opens the view for an unknown ?sub=, dropping it", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=nonsense");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook");
  });

  it("opens Population impact's Living standards for an old Baseline outlook link", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=baseline&ls_from=2028");
    render(<App />);
    expect(screen.getByRole("tab", { name: "Population impact" })).toHaveAttribute("aria-selected", "true");
    const living = await screen.findByRole("tabpanel", { name: "Living standards" });
    expect(await within(living).findByRole("heading", { name: "Incomes under current law" }, { timeout: 5000 })).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.has("tab")).toBe(false);
    expect(params.get("sub")).toBe("living");
    // The cards' own choices carry over
    expect(params.get("ls_from")).toBe("2028");
  });

  it("states its engine, data, status, notes and gaps once, in Methodology", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    render(<App />);
    const section = await screen.findByRole("region", { name: "Pre-measures forecast" });
    expect(await within(section).findByText("policyengine 6.10.2 (policyengine-uk 2.132.6)")).toBeInTheDocument();
    expect(within(section).getByText("Microcosm UK national, 19 Oct 2026 (6cba5d71)")).toBeInTheDocument();
    expect(within(section).getByText("Unvalidated")).toBeInTheDocument();
    expect(within(section).getByText(/2027-28 prices/)).toBeInTheDocument();
    expect(within(section).getByText("2027-28 to 2031-32")).toBeInTheDocument();
    // The UC health element fix, with its upstream pull request
    expect(within(section).getByRole("link", { name: "policyengine-uk #2428" })).toHaveAttribute(
      "href",
      "https://github.com/PolicyEngine/policyengine-uk/pull/2428",
    );
    expect(within(section).getByText(/Patched for 2030-31 and 2031-32/)).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: "What the baseline leaves out" })).toBeInTheDocument();
    expect(document.body.textContent.match(/unvalidated/gi)).toHaveLength(1);
  });

  it("hides the year and policy pills but keeps the band's layout", () => {
    window.history.replaceState({}, "", "/?tab=outlook");
    const { container } = render(<App />);
    for (const selector of [".band-year", ".band-policy"]) {
      const pill = band(container).querySelector(selector);
      // Still in the band, holding its place, but hidden and out of reach
      expect(pill).toHaveClass("is-hidden");
      expect(pill).toHaveAttribute("aria-hidden", "true");
      expect(pill).toHaveAttribute("inert");
    }
    expect(screen.getByRole("tab", { name: "Pre-measures forecast" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

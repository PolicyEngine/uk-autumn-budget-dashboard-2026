import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../App";

const OUTLOOK = readFileSync(
  join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"),
  "utf8",
);

beforeEach(() => {
  // The outlook JSON for the Living standards view; an empty CSV for the rest
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).endsWith("living_standards_outlook.json")
        ? new Response(OUTLOOK, { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response("reform_id,year,value\n", { status: 200 }),
    ),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (container) => container.querySelector(".title-row");

describe("the Living standards view", () => {
  it("is the third view tab, and choosing it shows the outlook", async () => {
    const { container } = render(<App />);
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toHaveAttribute("aria-hidden");
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[2]).toHaveTextContent("Living standards");
    fireEvent.click(tabs[2]);

    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Living standards" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    // Baseline outlook is the sub-tab it opens on
    expect(screen.getByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Forecast changes" })).toBeNull();
    // Its engine and data are said in Methodology, not on this view
    expect(screen.queryByText(/policyengine 6\.8\.0/)).toBeNull();
    expect(screen.queryByText("Demo")).toBeNull();
    expect(window.location.search).toBe("?tab=living");
  });

  it("splits into Baseline outlook and Forecast changes sub-tabs, with the intro shared", async () => {
    window.history.replaceState({}, "", "/?tab=living");
    render(<App />);
    const subTabs = await screen.findByRole("tablist", { name: "Living standards sections" });
    const [baseline, forecast] = within(subTabs).getAllByRole("tab");
    expect([baseline, forecast].map((t) => t.textContent)).toEqual(["Baseline outlook", "Forecast changes"]);
    // No tab-level intro: the sections start straight under the sub-tabs
    expect(screen.queryByText(/^Projections of UK household incomes and poverty/)).toBeNull();

    const panel = () => screen.getByRole("tabpanel", { name: /^(Baseline outlook|Forecast changes)$/ });
    expect(panel()).toHaveAccessibleName("Baseline outlook");
    for (const name of ["Incomes", "Poverty"]) {
      expect(within(panel()).getByRole("heading", { name })).toBeInTheDocument();
    }
    // Each section is one row of two cards that line up: Incomes over time
    // beside Growth across the distribution, Poverty over time beside Who is
    // in poverty. The period is in each title.
    const card = (name) => within(panel()).getByRole("heading", { level: 3, name }).closest(".ls-card");
    const incomes = card(/^Incomes over time$/);
    expect(incomes.closest(".charts-grid")).toBe(card(/^Growth across the distribution$/).closest(".charts-grid"));
    const poverty = card(/^Poverty over time$/);
    expect(poverty.closest(".charts-grid")).toBe(card(/^Who is in poverty$/).closest(".charts-grid"));
    expect(panel().querySelectorAll(".ls-card")).toHaveLength(4);
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

    fireEvent.click(forecast);
    expect(forecast).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAccessibleName("Forecast changes");
    expect(within(panel()).getByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    // The OBR's household income per person card is gone
    expect(within(panel()).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();
    expect(within(panel()).queryByText(/disposable income per person/)).toBeNull();
    expect(within(panel()).queryByRole("heading", { name: "Incomes" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");
    expect(screen.queryByText(/^Projections of UK household incomes and poverty/)).toBeNull();

    fireEvent.click(baseline);
    expect(new URLSearchParams(window.location.search).has("sub")).toBe(false);
    expect(window.location.search).toBe("?tab=living");
  });

  it("compares the years chosen in the range pill on Incomes and Poverty over time", async () => {
    window.history.replaceState({}, "", "/?tab=living&ls_from=2028&ls_to=2030");
    render(<App />);
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re });
    const incomes = (await heading(/^Incomes over time/)).closest(".ls-card");
    const poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    for (const card of [incomes, poverty]) {
      // The shared pill shows the chosen years, and the sentence compares them
      expect(within(card).getByRole("group", { name: "Years compared" })).toHaveTextContent(/2028-29.*2030-31/);
      expect(card).toHaveTextContent(/2028-29/);
      expect(card).toHaveTextContent(/2030-31/);
      expect(card.querySelector(".ls-summary, p")).not.toHaveTextContent(/from 2027-28 to 2031-32/);
    }
  });

  it("switches each card's view with its switch, and never shows a signed zero", async () => {
    window.history.replaceState({}, "", "/?tab=living");
    render(<App />);
    const heading = (re) => screen.findByRole("heading", { level: 3, name: re });
    const choose = (card, pill, option) => {
      fireEvent.click(within(card).getByRole("button", { name: new RegExp(`^${pill}:`) }));
      fireEvent.click(within(card).getByRole("option", { name: option }));
    };

    // Poverty over time: Rate (with its Measure, Group and Period pills) or Depth
    let poverty = (await heading(/^Poverty over time/)).closest(".ls-card");
    expect(within(poverty).getByRole("button", { name: /^Population group:/ })).toBeInTheDocument();
    // The view is a "Show" pill (Rate or Depth), short labels in the pills
    expect(within(poverty).getByRole("button", { name: /^Poverty view:/ })).toHaveTextContent("Rate");
    expect(within(poverty).getByRole("button", { name: /^Poverty measure:/ })).toHaveTextContent("Abs. BHC");
    expect(within(poverty).getByRole("button", { name: /^Population group:/ })).toHaveTextContent("All");
    choose(poverty, "Poverty view", "Depth");
    poverty = (await heading(/^Poverty over time$/)).closest(".ls-card");
    expect(within(poverty).queryByRole("button", { name: /^Population group:/ })).toBeNull();
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
    choose(who, "Poverty measure", "Absolute poverty (AHC)");
    expect(within(who).getByText(/absolute child poverty rate/)).toBeInTheDocument();

    // Incomes over time and Growth across the distribution
    const incomes = (await heading(/^Incomes over time/)).closest(".ls-card");
    choose(incomes, "Income view", "Inequality");
    expect(within(incomes).getByRole("button", { name: /^Inequality measure:/ })).toBeInTheDocument();
    const growth = (await heading(/^Growth across the distribution/)).closest(".ls-card");
    expect(within(growth).getByText(/lowest-income tenth/)).toBeInTheDocument();
    choose(growth, "Distribution view", "By quintile");
    expect(within(growth).getByText(/lowest-income fifth/)).toBeInTheDocument();

    // The two years compared: chosen in one card, kept in the address and
    // followed by every card comparing two years
    choose(who, "Compare from", "2029-30");
    expect(new URLSearchParams(window.location.search).get("ls_from")).toBe("2029");
    // Titles carry no years (the pill, axes and sentence do): the sentences follow
    expect(await heading(/^Who is in poverty$/)).toBeInTheDocument();
    expect(within(who).getByText(/since 2029-30/)).toBeInTheDocument();
    expect(within(growth).getByText(/From 2029-30 to 2031-32/)).toBeInTheDocument();

    // A change that rounds to zero reads "no change", never "−0.0pp" or "0.0%"
    expect(document.body.textContent).not.toMatch(/[−-]0\.0(pp|%)/);
    expect(document.body.textContent).not.toMatch(/(rises|falls) 0\.0/);
  });

  it("opens the sub-tab a link names, and drops it on another view", async () => {
    window.history.replaceState({}, "", "/?tab=living&sub=forecast");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Forecast changes" })).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");

    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("methodology");
    expect(params.has("sub")).toBe(false);

    // Back on Living standards (kept mounted), the sub-tab left open stays,
    // with its ?sub= again
    fireEvent.click(screen.getByRole("tab", { name: "Living standards" }));
    expect(await screen.findByRole("tab", { name: "Forecast changes" })).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");
  });

  it("opens Baseline outlook for an unknown ?sub=", async () => {
    window.history.replaceState({}, "", "/?tab=living&sub=nonsense");
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?tab=living");
  });

  it("states its engine, data, status, notes and gaps once, in Methodology", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    render(<App />);
    const section = await screen.findByRole("region", { name: "Living standards" });
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
    window.history.replaceState({}, "", "/?tab=living");
    const { container } = render(<App />);
    for (const selector of [".band-year", ".band-policy"]) {
      const pill = band(container).querySelector(selector);
      // Still in the band, holding its place, but hidden and out of reach
      expect(pill).toHaveClass("is-hidden");
      expect(pill).toHaveAttribute("aria-hidden", "true");
      expect(pill).toHaveAttribute("inert");
    }
    expect(screen.getByRole("tab", { name: "Living standards" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

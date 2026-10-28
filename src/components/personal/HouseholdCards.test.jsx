import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HouseholdCards, { YearBars } from "./HouseholdCards";
import { HOUSEHOLD_EXAMPLES } from "../../utils/householdExamples";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";

// #104 review (m23, P2): a card names the measures it features only while
// the catalogue publishes every one of them. The driver's card features the
// fuel duty measure.
const baseEntry = fixtureJson("manifest.json").measures.alpha;
const NAMES = {
  fuel_duty_rise_deferral: "Fuel duty cut extended",
  property_income_rates_up: "Property income tax up",
  savings_income_rates_up: "Savings income tax up",
  carers_allowance_earnings_taper: "Carer's Allowance taper",
};
const publishing = (ids) =>
  buildMeasureCatalogue({
    manifest: {
      ...fixtureJson("manifest.json"),
      // Named as published: a chip names its measure by its short name
      measures: Object.fromEntries(ids.map((id) => [id, { ...baseEntry, name: NAMES[id] ?? id, years: [2029], unsupported_years: [] }])),
      combined: {},
    },
    tablesByKey: Object.fromEntries(ids.map((id) => [id, {}])),
  });

const driverTag = (catalogue) => {
  render(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={null} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={null} yoursChange={null} year={2029} chosen={false} yoursSelected={false} />
    </MeasureCatalogueProvider>,
  );
  const driver = screen.getByRole("button", { name: /^A driver with a long commute/ });
  return driver.closest(".household-card").querySelector(".household-card-tag")?.textContent ?? null;
};

it("names the fuel measure on the driver's card while it is published", () => {
  expect(driverTag(publishing(["fuel_duty_rise_deferral"]))).toMatch(/fuel duty/i);
});

it("names none while it is withdrawn (on Budget day, say)", () => {
  expect(driverTag(publishing(["state_pension_income_tax_protection"]))).toBeNull();
});

describe("a card's year bars", () => {
  const series = [
    { year: 2027, change: 88 },
    { year: 2028, change: 40 },
    { year: 2029, change: 12 },
    { year: 2030, change: 0 },
    { year: 2031, change: -25 },
  ];

  it("are labelled with every year's figure and name the first and last years", () => {
    render(<YearBars series={series} year={2027} />);
    const bars = screen.getByRole("group", { name: /^Change in net income by year/ });
    expect(bars).toHaveAttribute(
      "aria-label",
      "Change in net income by year: 2027-28 +£88 a year, 2028-29 +£40 a year, 2029-30 +£12 a year, 2030-31 No change, 2031-32 −£25 a year",
    );
    expect(bars).toHaveAttribute("tabindex", "0");
    expect(bars.querySelector(".household-card-spark-years")).toHaveTextContent("27–2831–32");
    // The year chosen is highlighted; no tooltip until hovered or focused
    expect(bars.querySelectorAll("rect.is-current")).toHaveLength(1);
    expect(bars.querySelector(".household-card-spark-tip")).toHaveTextContent("");
  });

  it("show a year's figure when hovered, and move with the arrow keys once focused", () => {
    render(<YearBars series={series} year={2027} />);
    const bars = screen.getByRole("group", { name: /^Change in net income by year/ });
    const tip = bars.querySelector(".household-card-spark-tip");
    fireEvent.pointerEnter(bars.querySelectorAll("rect.household-card-spark-hit")[2]);
    expect(tip).toHaveTextContent("2029-30: +£12 a year");
    expect(tip).toHaveClass("is-shown");
    fireEvent.pointerLeave(bars, { pointerType: "mouse" });
    expect(tip).not.toHaveClass("is-shown");
    fireEvent.focus(bars);
    expect(tip).toHaveTextContent("2027-28: +£88 a year");
    fireEvent.keyDown(bars, { key: "End" });
    expect(tip).toHaveTextContent("2031-32: −£25 a year");
    fireEvent.keyDown(bars, { key: "ArrowLeft" });
    expect(tip).toHaveTextContent("2030-31: No change");
    fireEvent.blur(bars);
    expect(tip).not.toHaveClass("is-shown");
  });
});

describe("where an example sits", () => {
  it("is its percentile after the measures, on the published curves, with the household's equivalisation", async () => {
    const { examplePercentile } = await import("./HouseholdCards");
    const example = HOUSEHOLD_EXAMPLES[0];
    // A straight curve: percentile p at £p,000 a year, adjusted
    const rows = ["baseline", "reform"].flatMap((side) =>
      Array.from({ length: 99 }, (_, i) => ({ reformId: "alpha", year: 2027, side, percentile: i + 1, income: (i + 1) * 1000 })),
    );
    const point = { change: 100, before: 18000, after: 18100 };
    // One adult: £18,100 adjusted to a couple's (÷ 0.67) is £27,015, the 27th
    expect(examplePercentile(example, point, { year: 2027, policies: ["alpha"], rows, catalogue: null })).toBe(27);
    // No curve for the measures, or no net income: none
    expect(examplePercentile(example, point, { year: 2027, policies: ["beta"], rows, catalogue: null })).toBeNull();
    expect(examplePercentile(example, { change: 1 }, { year: 2027, policies: ["alpha"], rows, catalogue: null })).toBeNull();
  });

  it("reads several measures from the manifest's package only, never another package's rows (issue 228)", async () => {
    const { examplePercentile } = await import("./HouseholdCards");
    const example = HOUSEHOLD_EXAMPLES[0];
    const KEY = "combined--alpha+beta";
    const curve = (reformId) =>
      ["baseline", "reform"].flatMap((side) =>
        Array.from({ length: 99 }, (_, i) => ({ reformId, year: 2027, side, percentile: i + 1, income: (i + 1) * 1000 })),
      );
    const approved = { status: "approved", outputs_sha256: "a".repeat(64) };
    const catalogue = {
      manifest: {
        measures: { alpha: approved, beta: approved, gamma: approved },
        combined: { [KEY]: { status: "approved", measures: ["alpha", "beta"], member_outputs_sha256: { alpha: "a".repeat(64), beta: "a".repeat(64) } } },
      },
    };
    const point = { change: 100, before: 18000, after: 18100 };
    const args = (rows) => ({ year: 2027, policies: ["alpha", "beta"], rows, catalogue });
    // The registry's own package id is another package: no position
    expect(examplePercentile(example, point, args(curve("autumn_budget_2026_combined")))).toBeNull();
    expect(examplePercentile(example, point, args(curve(KEY)))).toBe(27);
    // No combined run of exactly these: none, never the pair's or one policy's
    const rows = [...curve(KEY), ...curve("alpha")];
    expect(examplePercentile(example, point, { ...args(rows), policies: ["alpha", "gamma"] })).toBeNull();
  });
});

describe("what the figures are with", () => {
  it("says it on hover, not in a line above the cards", () => {
    const byYear = { 2027: { change: 81, before: 20000, after: 20081 } };
    const presets = Object.fromEntries(HOUSEHOLD_EXAMPLES.map((example) => [example.id, byYear]));
    const fill = { pending: new Set(), failed: new Set(), reduced: ["fuel_duty_rise_deferral"] };
    render(
      <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={null} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={presets} fill={fill} yoursChange={null} year={2027} />,
    );
    expect(screen.queryByText(/^Figures are the change/)).toBeNull();
    const figure = document.querySelector(".household-card-figure");
    fireEvent.mouseEnter(figure);
    expect(document.getElementById(figure.getAttribute("aria-describedby"))).toHaveTextContent(
      "Change in net income in 2027-28 with the policies the calculator supports",
    );
  });
});

// A chosen card, Your household or a chip shows it by its fill and border
// and aria-pressed / aria-selected only: never a tick badge.
describe("the chosen household", () => {
  const ticks = () => document.querySelectorAll(".lucide-check, .household-card-check");
  const first = HOUSEHOLD_EXAMPLES[0];

  it.each([
    ["an example card", { value: first.id, yoursSelected: false }],
    ["Your household", { value: null, yoursSelected: true }],
  ])("shows no tick on %s, folded or not", (_, props) => {
    for (const chosen of [false, true]) {
      const { unmount } = render(
        <HouseholdCards examples={HOUSEHOLD_EXAMPLES} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={null} yoursChange={null} year={2029} chosen={chosen} {...props} />,
      );
      expect(ticks()).toHaveLength(0);
      unmount();
    }
  });

  it("is still pressed for assistive tech", () => {
    render(
      <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={first.id} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={null} yoursChange={null} year={2029} />,
    );
    const card = screen.getByRole("button", { name: new RegExp(`^${first.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card.closest(".household-card")).toHaveClass("is-selected");
  });
});

describe("an example card's chip tooltip (W6 G1)", () => {
  it("features its own measures, each with its part, and names a larger single effect in the tip, never 'most of the change'", () => {
    // Illustrative figures: a loss of £90 overall, the example's own
    // measure (property) −£200, savings −£60, a gain of £320 from
    // another: the largest, but not most of a loss
    const [property, savings] = ["property_income_rates_up", "savings_income_rates_up"];
    const other = "fuel_duty_rise_deferral";
    const catalogue = publishing([property, savings, other]);
    const presets = { "landlord-saver": { 2029: { change: -90, before: 40000, after: 39910, byPolicy: { [property]: -200, [savings]: -60, [other]: 320 } } } };
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={null} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={presets} yoursChange={null} year={2029} chosen={false} yoursSelected={false} />
      </MeasureCatalogueProvider>,
    );
    const card = screen.getByRole("button", { name: /^A landlord with savings/ }).closest(".household-card");
    // Its own measure, property only (the savings rate is not in the
    // release), with its own part, never cut short
    expect([...card.querySelectorAll(".household-card-tag")].map((tag) => tag.textContent)).toEqual(["Property income tax up−£200"]);
    const tag = card.querySelector(".household-card-tags");
    fireEvent.mouseEnter(tag);
    const tip = document.getElementById(tag.getAttribute("aria-describedby"));
    expect(tip).toHaveTextContent(/^This example features Property income tax up \(−£200 in 2029-30\); the largest single effect is .+ \(\+£320\)\.$/);
    expect(tip).not.toHaveTextContent(/most of the change/);
  });
});

describe("the carer's card before its measure starts", () => {
  it("features the taper, muted, with the year it starts, not another measure", () => {
    const [taper, other] = ["carers_allowance_earnings_taper", "fuel_duty_rise_deferral"];
    const catalogue = publishing([taper, other]);
    const presets = {
      carer: {
        2027: { change: 13, before: 20000, after: 20013, byPolicy: { [taper]: 0, [other]: 13 } },
        2030: { change: 1578, before: 20000, after: 21578, byPolicy: { [taper]: 1565, [other]: 13 } },
      },
    };
    const cardFor = (year) => {
      const { unmount } = render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={null} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={presets} yoursChange={null} year={year} chosen={false} yoursSelected={false} />
        </MeasureCatalogueProvider>,
      );
      const card = screen.getByRole("button", { name: /^A carer/ }).closest(".household-card");
      const tags = [...card.querySelectorAll(".household-card-tag")].map((tag) => [tag.textContent, tag.classList.contains("is-later")]);
      unmount();
      return tags;
    };
    expect(cardFor(2027)).toEqual([["Carer's Allowance taperfrom 2030-31", true]]);
    expect(cardFor(2030)).toEqual([["Carer's Allowance taper+£1,565", false]]);
  });
});

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HouseholdCards, { YearBars } from "./HouseholdCards";
import { HOUSEHOLD_EXAMPLES } from "../../utils/householdExamples";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";

// #104 review (m23, P2): a card names the measures it features only while
// the catalogue publishes every one of them. The driver's card features the
// fuel duty deferral and the road fuel VAT cut together.
const baseEntry = fixtureJson("manifest.json").measures.alpha;
const publishing = (ids) =>
  buildMeasureCatalogue({
    manifest: {
      ...fixtureJson("manifest.json"),
      measures: Object.fromEntries(ids.map((id) => [id, { ...baseEntry, name: id, years: [2029], unsupported_years: [] }])),
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

it("names both fuel measures on the driver's card while both are published", () => {
  expect(driverTag(publishing(["fuel_duty_rise_deferral", "road_fuel_vat_cut"]))).toMatch(/fuel VAT/i);
});

it("names neither while one of them is withdrawn (on Budget day, say)", () => {
  expect(driverTag(publishing(["fuel_duty_rise_deferral", "state_pension_income_tax_protection"]))).toBeNull();
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
});

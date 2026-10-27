import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import MeasureEffectsView from "./MeasureEffectsView";
import { SUMMARY_METRICS } from "./SummaryMetricChart";

const BY_MEASURE = [
  { id: "a", name: "Measure A", colour: "#123456", points: [{ year: 2027, value: -0.5 }, { year: 2028, value: 0.4 }] },
];
const YEARS = [2027, 2028];

describe("MeasureEffectsView year-by-year table", () => {
  it("shades poverty changes in the gain and loss colours", () => {
    const { container } = render(
      <MeasureEffectsView byMeasure={BY_MEASURE} metric={SUMMARY_METRICS.poverty} selectedYear={2027} view="years" years={YEARS} />,
    );
    const table = container.querySelector("table.mev-table");
    expect(table).not.toHaveClass("is-neutral");
    expect(table.querySelector("td.is-fall")).not.toBeNull();
    expect(table.querySelector("td.is-rise")).not.toBeNull();
  });

  it("shades inequality changes in one neutral colour, not as gains or losses", () => {
    const { container } = render(
      <MeasureEffectsView byMeasure={BY_MEASURE} metric={SUMMARY_METRICS.inequality} selectedYear={2027} view="years" years={YEARS} />,
    );
    expect(container.querySelector("table.mev-table")).toHaveClass("is-neutral");
  });
});

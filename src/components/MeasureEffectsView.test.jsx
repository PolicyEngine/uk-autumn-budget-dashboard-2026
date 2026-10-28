import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import MeasureEffectsView from "./MeasureEffectsView";
import { SUMMARY_METRICS } from "./SummaryMetricChart";
import { CHART_COLOURS } from "../utils/chartTheme";

const BY_MEASURE = [
  { id: "a", name: "Measure A", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: -0.5 }, { year: 2028, value: 0.4 }] },
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

describe("MeasureEffectsView this year", () => {
  const BY = [
    { id: "a", name: "Moves", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: -0.02 }] },
    { id: "b", name: "Tiny", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: -0.00001 }] },
    { id: "c", name: "Nothing", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: 0 }] },
  ];

  it("gives every selected policy a row: bars for any non-zero change, however small, and No change with why for exactly 0", () => {
    const { container } = render(<MeasureEffectsView byMeasure={BY} metric={SUMMARY_METRICS.poverty} selectedYear={2027} view="year" years={[2027]} />);
    const rows = [...container.querySelectorAll(".mev-row")];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => Boolean(r.querySelector(".mev-bar")))).toEqual([true, true, false]);
    expect(rows[1].querySelector(".mev-value")).toHaveTextContent(/^under /);
    expect(rows[2]).toHaveTextContent(/No change/);
    expect(rows[2].querySelector(".mev-reason").textContent).toBe("no one crosses the poverty line");
    expect(container).not.toHaveTextContent(/hidden/);
  });
});


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


describe("MeasureEffectsView this year: bars by direction", () => {
  const BY = [
    { id: "a", name: "Big fall", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: -0.4 }] },
    { id: "b", name: "Small fall", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: -0.01 }] },
    { id: "c", name: "Rise", colour: CHART_COLOURS.reference, points: [{ year: 2027, value: 0.2 }] },
  ];
  // jsdom gives inline colours back as rgb()
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

  for (const choice of ["inequality", "poverty"]) {
    it(`colours ${choice} bars by direction only, with a key that says which is which`, () => {
      const { container } = render(<MeasureEffectsView byMeasure={BY} metric={SUMMARY_METRICS[choice]} selectedYear={2027} view="year" years={[2027]} />);
      const bars = [...container.querySelectorAll(".mev-bar")].map((bar) => bar.style.background);
      // Largest first: a fall, the rise, the small fall; both falls one colour
      expect(bars).toEqual([rgb(CHART_COLOURS.gain), rgb(CHART_COLOURS.loss), rgb(CHART_COLOURS.gain)]);
      expect([...container.querySelectorAll(".mev-key li")].map((li) => li.textContent)).toEqual([`Lowers ${choice}`, `Raises ${choice}`]);
    });
  }
});

// #285 review, finding 7: a year the floor of survey households withheld
// that is not the selected one has no bar, so the chart says "Not
// published" at it and in its hover, never leaving a gap that reads as no
// change. Its own file: the chart is drawn at a fixed size (recharts'
// ResponsiveContainer mocked), which the other chart tests do not need.
import { cloneElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import SummaryMetricChart, {
  NOT_PUBLISHED,
  SUMMARY_METRICS,
  SummaryTooltip,
  WithheldYearLabels,
  summaryTooltipNote,
} from "./SummaryMetricChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fiscalYearTick } from "../utils/chartTheme";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    // A fixed size, so the chart draws in jsdom
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 800, height: 340 }}>{cloneElement(children, { width: 800, height: 340 })}</div>
    ),
  };
});

const RUN = "fuel_duty_rise_deferral";
const POLICIES = [{ id: RUN, name: "Fuel duty rises deferred" }];
const catalogue = { ...buildMeasureCatalogue(), combinedId: "autumn_budget_2026_combined" };
const NOTE = `${NOT_PUBLISHED}: too few survey households`;

describe("the hover's line for a summary chart's year", () => {
  const people = (year, value) => `people ${year} ${value}`;

  it("says a withheld year is not published", () => {
    expect(summaryTooltipNote({ year: 2027, value: null, withheld: true }, people)).toBe(NOTE);
  });

  it("is the people a change is otherwise, and nothing for no figure", () => {
    expect(summaryTooltipNote({ year: 2028, value: -0.002, withheld: false }, people)).toBe("people 2028 -0.002");
    expect(summaryTooltipNote({ year: 2028, value: null, withheld: false }, people)).toBeNull();
    expect(summaryTooltipNote({ year: 2028, value: 0, withheld: false }, people)).toBeNull();
    expect(summaryTooltipNote(undefined, people)).toBeNull();
  });
});

describe("the hover for a summary chart's year", () => {
  const hover = (point) => (
    <MeasureCatalogueProvider catalogue={catalogue}>
      <SummaryTooltip
        active
        label={point.year}
        labelFormat={fiscalYearTick}
        format={(value) => `${value}pp`}
        grouped={false}
        showZero
        payload={[{ dataKey: "value", name: "Poverty", value: point.value, payload: point }]}
        note={(p) => summaryTooltipNote(p, () => null)}
      />
    </MeasureCatalogueProvider>
  );

  it("names a withheld year and says it is not published, never a change", () => {
    const { container } = render(hover({ year: 2027, value: null, withheld: true }));
    expect(container).toHaveTextContent("2027-28");
    expect(container.querySelector(".chart-tooltip-note")).toHaveTextContent(NOTE);
    expect(container.querySelector(".chart-tooltip-row")).toBeNull();
  });

  it("is not drawn for a year not yet published", () => {
    const { container } = render(hover({ year: 2028, value: null, withheld: false }));
    expect(container.querySelector(".chart-tooltip")).toBeNull();
  });
});

describe("the labels at withheld years", () => {
  // Two years' bands 100px wide, the zero line at y = 150 in a plot from
  // y = 10
  const band = Object.assign((year) => ({ 2027: 0, 2028: 100 })[year], { bandwidth: () => 100 });
  const axes = (zero) => ({ xAxisMap: { 0: { scale: band } }, yAxisMap: { 0: { scale: () => zero, y: 10 } } });
  const draw = (props) =>
    render(
      <svg>
        <WithheldYearLabels {...props} />
      </svg>,
    ).container;

  it("say Not published at each withheld year's band, and nowhere else", () => {
    const container = draw({ ...axes(150), points: [{ year: 2027, value: null, withheld: true }, { year: 2028, value: -0.1, withheld: false }] });
    const labels = container.querySelectorAll(".withheld-year-label");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent(NOT_PUBLISHED);
    expect(labels[0].getAttribute("data-year")).toBe("2027");
    expect(Number(labels[0].getAttribute("x"))).toBe(50);
    // Above the zero line where there is room
    expect(Number(labels[0].getAttribute("y"))).toBeLessThan(150);
  });

  it("go under the zero line when it is at the plot's top", () => {
    const container = draw({ ...axes(12), points: [{ year: 2027, value: null, withheld: true }] });
    expect(Number(container.querySelector(".withheld-year-label").getAttribute("y"))).toBeGreaterThan(12);
  });

  it("break onto two lines in a narrow band", () => {
    const narrow = Object.assign(() => 0, { bandwidth: () => 50 });
    const container = draw({ xAxisMap: { 0: { scale: narrow } }, yAxisMap: { 0: { scale: () => 150, y: 10 } }, points: [{ year: 2027, value: null, withheld: true }] });
    const lines = [...container.querySelectorAll(".withheld-year-label tspan")].map((t) => t.textContent);
    expect(lines).toEqual(["Not", "published"]);
  });

  it("draw nothing without axes", () => {
    expect(draw({ points: [{ year: 2027, value: null, withheld: true }] }).querySelector("text")).toBeNull();
  });
});

describe("a summary chart with a withheld year that is not the selected one", () => {
  it("draws Not published at that year, and a bar for the published one", () => {
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <SummaryMetricChart
          metric={SUMMARY_METRICS.poverty}
          rows={[
            { reform_id: RUN, year: "2027", poverty_change_pp: null },
            { reform_id: RUN, year: "2028", poverty_change_pp: "-0.002" },
          ]}
          policies={POLICIES}
          selectedPolicies={[RUN]}
          selectedYear={2028}
        />
      </MeasureCatalogueProvider>,
    );
    const labels = container.querySelectorAll(".withheld-year-label");
    expect([...labels].map((label) => label.getAttribute("data-year"))).toEqual(["2027"]);
    expect(within(labels[0]).getByText((_, node) => node.tagName === "text")).toBeTruthy();
    expect(labels[0].textContent.replace(/\s+/g, " ").trim()).toMatch(/^Not ?published$/);
    expect(container.querySelector(".chart-description")).not.toHaveTextContent(/Not published/);
  });

  it("says Not published in the hover at that year", () => {
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <SummaryMetricChart
          metric={SUMMARY_METRICS.poverty}
          rows={[
            { reform_id: RUN, year: "2027", poverty_change_pp: null },
            { reform_id: RUN, year: "2028", poverty_change_pp: "-0.002" },
          ]}
          policies={POLICIES}
          selectedPolicies={[RUN]}
          selectedYear={2028}
        />
      </MeasureCatalogueProvider>,
    );
    // At the 2027-28 tick, wherever the labels are
    const tick = [...container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")].find(
      (node) => node.textContent === "2027-28",
    );
    const x = Number(tick.getAttribute("x"));
    expect(document.body).not.toHaveTextContent(NOTE);
    const wrapper = container.querySelector(".recharts-wrapper");
    fireEvent.mouseMove(wrapper, { clientX: x, clientY: 150 });
    expect(document.body).toHaveTextContent(NOTE);
  });
});

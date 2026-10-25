import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SummaryMetricChart, { SUMMARY_METRICS, metricByYear } from "./SummaryMetricChart";
import { POLICIES } from "../utils/policies";
import { DISPLAY_YEARS } from "../utils/displayYears";

const ROWS = [
  { reform_id: "autumn_budget_2026_combined", year: "2027", gini_change: "-0.0016", poverty_change_pp: "-0.0075" },
  { reform_id: "fuel_duty_rise_deferral", year: "2027", gini_change: "-0.0002", poverty_change_pp: "-0.001" },
];

describe("metricByYear", () => {
  it("reads one run's rows, scaled, with null for a year it does not cover", () => {
    const points = metricByYear(ROWS, "autumn_budget_2026_combined", SUMMARY_METRICS.inequality);
    expect(points.map((point) => point.year)).toEqual([...DISPLAY_YEARS]);
    expect(points.find((point) => point.year === 2027).value).toBeCloseTo(-0.16);
    expect(points.find((point) => point.year === 2028).value).toBeNull();
    expect(metricByYear(ROWS, "fuel_duty_rise_deferral", SUMMARY_METRICS.poverty)[1].value).toBeCloseTo(-0.001);
  });

  it("has nothing without a run", () => {
    expect(metricByYear(ROWS, null, SUMMARY_METRICS.poverty)).toEqual([]);
  });
});

describe("SummaryMetricChart", () => {
  it("asks for one policy or all when the selection has no single run, never adding up", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={ROWS}
        policies={POLICIES}
        selectedPolicies={["fuel_duty_rise_deferral", "road_fuel_vat_cut"]}
        selectedYear={2027}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Choose one policy or all policies");
  });
});

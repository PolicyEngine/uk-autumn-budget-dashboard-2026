import { describe, expect, it } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import SummaryMetricChart, {
  SUMMARY_METRICS,
  metricByYear,
  parsePovertyChoice,
  povertyMetric,
} from "./SummaryMetricChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

// #185 on #104: the measures come from the catalogue, and its combined run
// is the package's (the run read when every measure is selected)
const POLICIES = [
  { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred" },
  { id: "road_fuel_vat_cut", name: "VAT cut on road fuel" },
  { id: "plan_2_threshold_unfreeze", name: "Plan 2 student loan threshold unfrozen" },
];
const catalogue = { ...buildMeasureCatalogue(), combinedId: "autumn_budget_2026_combined" };
const render = (ui) => rtlRender(ui, {
  wrapper: ({ children }) => <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>,
});
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

  it("says a run is not yet published rather than drawing zeros", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={ROWS.filter((row) => row.reform_id !== "autumn_budget_2026_combined")}
        policies={POLICIES}
        selectedPolicies={POLICIES.map((policy) => policy.id)}
        selectedYear={2027}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Not yet published for this selection");
  });

  it("says a selection changes nothing rather than drawing a plot of zeros", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={[{ reform_id: "fuel_duty_rise_deferral", year: "2027", gini_change: "-0.0004", poverty_change_pp: "0" }]}
        policies={POLICIES}
        selectedPolicies={["fuel_duty_rise_deferral"]}
        selectedYear={2027}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("do not change the poverty rate");
  });
});

describe("measure choices", () => {
  const WIDE = [
    {
      reform_id: "autumn_budget_2026_combined",
      year: "2027",
      gini_change: "-0.0016",
      poverty_change_pp: "-0.0075",
      child_poverty_rel_ahc_change_pp: "-0.42",
      poverty_rel_bhc_change_pp: "-0.1",
      top_10_share_change_pp: "-0.05",
      p90_p10_change: "-0.004",
    },
  ];
  const props = {
    policies: POLICIES,
    selectedPolicies: POLICIES.map((policy) => policy.id),
    selectedYear: 2027,
  };

  it("hides the pills when the file has only the headline columns", () => {
    render(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={ROWS} {...props} />);
    expect(screen.queryByRole("group", { name: "Poverty line" })).toBeNull();
    render(<SummaryMetricChart metric={SUMMARY_METRICS.inequality} rows={ROWS} {...props} />);
    expect(screen.queryByRole("group", { name: "Inequality measure" })).toBeNull();
  });

  it("names the poverty measure chosen and puts it in the address", () => {
    window.history.replaceState(null, "", "/?tab=dashboard&sub=poverty");
    render(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={WIDE} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Relative" }));
    fireEvent.click(screen.getByRole("button", { name: "After housing costs" }));
    fireEvent.click(screen.getByRole("button", { name: "Children" }));
    expect(screen.getByRole("heading")).toHaveTextContent("Change in the child poverty rate");
    expect(screen.getByText(/relative poverty after housing costs/)).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("poverty")).toBe("relative-ahc-children");
    expect(params.get("sub")).toBe("poverty");
  });

  it("reads the inequality measure from the address", () => {
    window.history.replaceState(null, "", "/?sub=living&inequality=top-10");
    render(<SummaryMetricChart metric={SUMMARY_METRICS.inequality} rows={WIDE} {...props} />);
    expect(screen.getByRole("button", { name: "Top 10% share" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/top 10% of people|10% of people with the highest incomes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gini" }));
    expect(new URLSearchParams(window.location.search).get("inequality")).toBeNull();
  });
});

describe("povertyMetric and parsePovertyChoice", () => {
  it("keeps the headline column for absolute, before housing costs, everyone", () => {
    expect(povertyMetric(parsePovertyChoice(null)).key).toBe("poverty_change_pp");
    expect(povertyMetric(parsePovertyChoice("relative-ahc-children")).key).toBe("child_poverty_rel_ahc_change_pp");
    expect(povertyMetric(parsePovertyChoice("absolute-ahc-all")).key).toBe("poverty_abs_ahc_change_pp");
    expect(parsePovertyChoice("nonsense-ahc")).toEqual({ basis: "absolute", housing: "ahc", group: "all" });
  });
});

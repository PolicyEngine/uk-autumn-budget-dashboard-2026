import { describe, expect, it } from "vitest";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import SummaryMetricChart, {
  SUMMARY_METRICS,
  metricByYear,
  metricValue,
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

  it("reads a row without the metric, or with an empty or null cell, as not published, never 0", () => {
    const run = "fuel_duty_rise_deferral";
    const at2027 = (rows) => metricByYear(rows, run, SUMMARY_METRICS.inequality).find((point) => point.year === 2027).value;
    expect(at2027([{ reform_id: run, year: "2027", poverty_change_pp: "-0.001" }])).toBeNull();
    expect(at2027([{ reform_id: run, year: "2027", gini_change: "" }])).toBeNull();
    expect(at2027([{ reform_id: run, year: "2027", gini_change: null }])).toBeNull();
    expect(at2027([{ reform_id: run, year: "2027", gini_change: "0" }])).toBe(0);
    expect(metricValue({ x: 0 }, "x")).toBe(0);
    expect([metricValue(undefined, "x"), metricValue({}, "x"), metricValue({ x: "n/a" }, "x")]).toEqual([null, null, null]);
  });
});

describe("SummaryMetricChart", () => {
  it("draws each measure's own series when the selection has no single run, never adding up", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={ROWS}
        policies={POLICIES}
        selectedPolicies={["fuel_duty_rise_deferral", "road_fuel_vat_cut"]}
        selectedYear={2027}
      />,
    );
    // No blocking message: one series per measure, with its key
    expect(screen.queryByText(/Choose one policy or all policies/)).toBeNull();
    // The selected year: one bar per measure with an effect, the rest counted
    expect(document.querySelectorAll(".mev-row")).toHaveLength(1);
    expect(screen.getByText("1 measure with no effect hidden")).toBeInTheDocument();
    expect(document.querySelector(".chart-description")).toHaveTextContent(/each measure on its own: biggest/i);
    // Year by year: a table of measures by years, never a sum
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "View" })).getByRole("radio", { name: "Year by year" }));
    expect(document.querySelectorAll(".mev-table tbody tr")).toHaveLength(1);
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
    expect(screen.queryByRole("button", { name: /^Options:/ })).toBeNull();
    render(<SummaryMetricChart metric={SUMMARY_METRICS.inequality} rows={ROWS} {...props} />);
    expect(screen.queryByRole("button", { name: /^Options:/ })).toBeNull();
  });

  it("names the poverty measure chosen and puts it in the address", () => {
    window.history.replaceState(null, "", "/?tab=dashboard&sub=poverty");
    render(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={WIDE} {...props} />);
    // One Options pill under the description, its choices as segmented
    // toggles in its popover
    const choices = document.querySelector(".summary-metric-choices");
    expect(choices.previousElementSibling).toHaveClass("chart-header");
    expect(screen.getByRole("button", { name: /^Options:/ })).toHaveAccessibleName("Options: Absolute · Before housing costs · All people");
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    const choose = (group, option) => {
      fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
    };
    choose("Poverty line", "Relative");
    choose("Housing costs", "After housing costs");
    choose("People", "Children");
    expect(screen.getByRole("button", { name: /^Options:/ })).toHaveAccessibleName("Options: Relative · After housing costs · Children");
    expect(screen.getByRole("heading")).toHaveTextContent("Change in the child poverty rate");
    // The line is the selected year's figure; what it measures, in More info
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(document.querySelector(".chart-footer")).toHaveTextContent(/relative/i);
    expect(document.querySelector(".chart-footer")).toHaveTextContent(/child/i);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("poverty")).toBe("relative-ahc-children");
    expect(params.get("sub")).toBe("poverty");
  });

  it("reads the inequality measure from the address", () => {
    window.history.replaceState(null, "", "/?sub=living&inequality=top-10");
    render(<SummaryMetricChart metric={SUMMARY_METRICS.inequality} rows={WIDE} {...props} />);
    expect(screen.getByRole("button", { name: /^Options:/ })).toHaveTextContent("Top 10% share");
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/top 10% of people|10% of people with the highest incomes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    const group = screen.getByRole("radiogroup", { name: "Inequality measure" });
    expect(within(group).getAllByRole("radio").map((o) => o.textContent)).toEqual([
      "Gini",
      "Top 10% share",
      "Top 1% share",
      "90/10 ratio",
    ]);
    fireEvent.click(within(group).getByRole("radio", { name: "Gini" }));
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

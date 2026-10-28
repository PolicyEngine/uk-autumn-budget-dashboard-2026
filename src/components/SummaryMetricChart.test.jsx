import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import SummaryMetricChart, {
  SUMMARY_METRICS,
  choiceRows,
  hasColumn,
  INEQUALITY_FILL,
  INEQUALITY_METRICS,
  metricByYear,
  metricSentence,
  metricValue,
  isWithheld,
  parsePovertyChoice,
  povertyMetric,
  sigFigs,
  tightAxis,
} from "./SummaryMetricChart";
import { CHART_COLOURS } from "../utils/chartTheme";
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
    // The selected year: a row per selected measure, a bar where it has an
    // effect; one with no row published that year says so, with no bar
    expect(document.querySelectorAll(".mev-row")).toHaveLength(2);
    expect(document.querySelectorAll(".mev-row .mev-bar")).toHaveLength(1);
    expect(document.querySelector(".mev-row--none")).toHaveTextContent(/Not published/);
    expect(screen.queryByText(/with no effect hidden/)).toBeNull();
    expect(document.querySelector(".chart-description")).toHaveTextContent(/each policy on its own: biggest/i);
    // Year by year: a table of measures by years, never a sum
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "View" })).getByRole("radio", { name: "Year by year" }));
    expect(document.querySelectorAll(".mev-table tbody tr")).toHaveLength(2);
  });

  it("names the year, as a sentence, when no selected policy moves the figure that year", () => {
    // W6 G1: a subset whose own changes are exactly 0 has no biggest bar;
    // the subtitle was "<metric short>, pp Each selected policy on its own."
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={[
          { reform_id: "fuel_duty_rise_deferral", year: "2027", poverty_change_pp: "0" },
          { reform_id: "road_fuel_vat_cut", year: "2027", poverty_change_pp: "0" },
        ]}
        policies={POLICIES}
        selectedPolicies={["fuel_duty_rise_deferral", "road_fuel_vat_cut"]}
        selectedYear={2027}
      />,
    );
    const subtitle = document.querySelector(".chart-description");
    expect(subtitle).toHaveTextContent(/^2027-28, each policy on its own\.$/);
    expect(document.querySelectorAll(".mev-row--none")).toHaveLength(2);
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

describe("choiceRows, each measure on its own", () => {
  it("offers no choice while a measure shown has rows without the measures", () => {
    // A run written after the poverty and inequality measures carries them
    // all (all or none per artifact); one written before, the headline only
    const WIDE = { child_poverty_rel_ahc_change_pp: "-0.001", p90_p10_change: "0.01", top_10_share_change_pp: "0.001" };
    const IDS = ["a", "b", "c"];
    fc.assert(
      fc.property(fc.tuple(...IDS.map(() => fc.constantFrom("wide", "headline", "none"))), fc.subarray(IDS, { minLength: 2 }), (kinds, shown) => {
        const rows = IDS.flatMap((id, i) =>
          kinds[i] === "none" ? [] : [{ reform_id: id, year: "2027", poverty_change_pp: "-0.001", ...(kinds[i] === "wide" ? WIDE : {}) }],
        );
        const decided = choiceRows(rows, null, shown);
        const offered = hasColumn(decided, "child_poverty_rel_ahc_change_pp") && hasColumn(decided, "p90_p10_change");
        // Never offered while a measure shown would read as no effect under
        // it; offered otherwise wherever a run carries them
        const lacking = shown.some((id) => kinds[IDS.indexOf(id)] === "headline");
        expect(offered).toBe(!lacking && kinds.includes("wide"));
      }),
      { numRuns: 200 },
    );
    // A run shown, or nothing shown, as before
    const rows = [{ reform_id: "a", year: "2027", p90_p10_change: "0.01" }, { reform_id: "b", year: "2027" }];
    expect(choiceRows(rows, "b")).toEqual([rows[1]]);
    expect(choiceRows(rows, null)).toBe(rows);
  });
});

describe("tightAxis", () => {
  it("fits the bars: to each side with round ticks when they go both ways, from zero when one way", () => {
    expect(tightAxis([-0.016, -0.007, 0.043])).toEqual({ domain: [-0.02, 0.05], ticks: [-0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05] });
    expect(tightAxis([-0.007, -0.004]).domain).toEqual([-0.01, 0]);
  });
});

describe("the card's sentence", () => {
  const top10 = INEQUALITY_METRICS["top-10"];
  it("is plain and precise: two significant digits, never 'less than 0.1'", () => {
    expect(sigFigs(0.00832)).toBe("0.0083");
    expect(sigFigs(0.16)).toBe("0.16");
    expect(sigFigs(1.234)).toBe("1.2");
    expect(metricSentence(top10, "2029-30", -0.00832)).toBe(
      "In 2029-30 the selected policies lower the top 10% income share by about 0.0083 percentage points.",
    );
    expect(metricSentence(INEQUALITY_METRICS.gini, "2029-30", 0.16)).toBe(
      "In 2029-30 the selected policies raise income inequality (the Gini coefficient) by about 0.16%.",
    );
    expect(metricSentence(povertyMetric(parsePovertyChoice(null)), "2029-30", -0.012, "about 4,200 people")).toBe(
      "In 2029-30 the selected policies move about 4,200 people out of absolute poverty before housing costs, lowering the rate by about 0.012 percentage points.",
    );
  });
  it("says almost no change only when the change rounds to 0.00", () => {
    expect(metricSentence(top10, "2029-30", 0.004)).toBe("In 2029-30 the selected policies make almost no change to the top 10% income share.");
    expect(metricSentence(top10, "2029-30", 0.005)).toMatch(/raise the top 10% income share by about 0.005 percentage points/);
  });
});

describe("the inequality chart", () => {
  it("draws its bars in the neutral teal-slate, never gain or loss, with unit ticks", () => {
    expect(INEQUALITY_FILL).toBe(CHART_COLOURS.highlight);
    expect([CHART_COLOURS.gain, CHART_COLOURS.loss, CHART_COLOURS.noChange]).not.toContain(INEQUALITY_FILL);
    const { container } = render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.inequality}
        rows={[
          { reform_id: "fuel_duty_rise_deferral", year: "2027", gini_change: "-0.0004", p90_p10_change: "0.001", top_10_share_change_pp: "-0.008" },
          { reform_id: "fuel_duty_rise_deferral", year: "2028", gini_change: "-0.0006", p90_p10_change: "0.001", top_10_share_change_pp: "-0.012" },
        ]}
        policies={POLICIES}
        selectedPolicies={["fuel_duty_rise_deferral"]}
        selectedYear={2027}
      />,
    );
    expect(container.querySelector(".chart-description")).toHaveTextContent(
      "In 2027-28 the selected policies lower income inequality (the Gini coefficient) by about 0.04%.",
    );
    expect(container.querySelector(".chart-description strong")).toBeNull();
  });
});

describe("a figure the floor of survey households withheld", () => {
  const run = "fuel_duty_rise_deferral";
  const single = { policies: POLICIES, selectedPolicies: [run], selectedYear: 2027 };

  it("is null and marked withheld only where the row carries the column empty", () => {
    expect(isWithheld({ poverty_change_pp: null }, "poverty_change_pp")).toBe(true);
    // A run written before the measure, or a missing row, is not withheld
    expect(isWithheld({}, "poverty_change_pp")).toBe(false);
    expect(isWithheld(undefined, "poverty_change_pp")).toBe(false);
    expect(isWithheld({ poverty_change_pp: 0 }, "poverty_change_pp")).toBe(false);
    const points = metricByYear([{ reform_id: run, year: "2027", poverty_change_pp: null }], run, SUMMARY_METRICS.poverty);
    expect(points.find((point) => point.year === 2027)).toMatchObject({ value: null, withheld: true });
    expect(points.find((point) => point.year === 2028)).toMatchObject({ value: null, withheld: false });
  });

  it("says the selected year's figure is not published, never no change", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={[
          { reform_id: run, year: "2027", poverty_change_pp: null },
          { reform_id: run, year: "2028", poverty_change_pp: "-0.002" },
        ]}
        {...single}
      />,
    );
    expect(document.querySelector(".chart-description")).toHaveTextContent("Not published for 2027-28: too few survey households are behind it.");
    expect(document.querySelector(".chart-description")).not.toHaveTextContent(/do not change/);
  });

  it("says so when every year is withheld, rather than not yet published", () => {
    render(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={[{ reform_id: run, year: "2027", poverty_change_pp: null }]} {...single} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not published: too few survey households are behind these figures");
  });

  it("each measure on its own, year by year: the withheld cell says Not published", () => {
    render(
      <SummaryMetricChart
        metric={SUMMARY_METRICS.poverty}
        rows={[
          { reform_id: run, year: "2027", poverty_change_pp: null },
          { reform_id: "road_fuel_vat_cut", year: "2027", poverty_change_pp: "-0.003" },
        ]}
        policies={POLICIES}
        selectedPolicies={[run, "road_fuel_vat_cut"]}
        selectedYear={2027}
      />,
    );
    expect(document.querySelector(".mev-row--none")).toHaveTextContent("Not published");
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "View" })).getByRole("radio", { name: "Year by year" }));
    const cells = [...document.querySelectorAll(".mev-table tbody td")].map((cell) => cell.textContent);
    expect(cells).toContain("Not published");
    expect(cells).not.toContain("0");
  });
});

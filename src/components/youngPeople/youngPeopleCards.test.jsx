import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MeasuresCard from "./MeasuresCard";
import { expectStandardDownloads } from "../../test/downloadMenus";
import TrendCard, { missingGroupsNote, yearList } from "./TrendCard";
import {
  SINGLE_AGE_FIRST,
  SINGLE_AGE_LAST,
  changeByYear,
  fitRange,
  measureComparison,
  niceRange,
  singleAgeBars,
  wrapWords,
} from "./youngPeopleData";
import { MIN_SAMPLE_SIZE } from "../../utils/ageImpact";
import { groupSeries } from "../../utils/ageGroups";
import { DISPLAY_YEARS } from "../../utils/displayYears";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div data-testid="recharts-responsive-container" style={{ width: 800, height: 500 }}>
        {children}
      </div>
    ),
  };
});

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "threshold_freeze_extension", name: "Threshold freeze extension" },
  { id: "salary_sacrifice_cap", name: "Salary sacrifice cap" },
];
const ALL = POLICIES.map((policy) => policy.id);

const row = (reform_id, year, age_band, mean_change, sample_size = 5000) => ({
  reform_id,
  year,
  age_band,
  mean_change,
  sample_size,
});

const ROWS = [
  row("two_child_limit", 2028, "16-24", 190),
  row("two_child_limit", 2028, "all", 230),
  row("threshold_freeze_extension", 2028, "16-24", -160),
  row("threshold_freeze_extension", 2028, "all", -150),
  row("salary_sacrifice_cap", 2028, "16-24", 0),
  row("salary_sacrifice_cap", 2028, "all", 0),
  row("two_child_limit", 2029, "16-24", 220),
  row("two_child_limit", 2029, "all", 260),
  row("threshold_freeze_extension", 2029, "16-24", -330),
  row("threshold_freeze_extension", 2029, "all", -300),
  row("salary_sacrifice_cap", 2029, "16-24", -120),
  row("salary_sacrifice_cap", 2029, "all", -110),
];

describe("young people data", () => {
  it("compares each policy's own figures, largest effect on young people first", () => {
    const { shown, noEffect } = measureComparison(ROWS, POLICIES, ALL, 2029);
    expect(shown.map((point) => point.name)).toEqual([
      "Threshold freeze extension",
      "2 child limit repeal",
      "Salary sacrifice cap",
    ]);
    expect(shown[0]).toMatchObject({ group: -330, all: -300 });
    expect(noEffect).toEqual([]);
  });

  it("compares any age group with all ages", () => {
    const rows = [
      ...ROWS,
      row("two_child_limit", 2029, "0-15", 700),
      row("threshold_freeze_extension", 2029, "0-15", -50),
      row("salary_sacrifice_cap", 2029, "0-15", -10),
    ];
    const { shown } = measureComparison(rows, POLICIES, ALL, 2029, "0-15");
    expect(shown.map((point) => point.name)).toEqual([
      "2 child limit repeal",
      "Threshold freeze extension",
      "Salary sacrifice cap",
    ]);
    expect(shown[0]).toMatchObject({ group: 700, all: 260 });
  });

  it("lists policies with no effect and hides thin rows", () => {
    const thin = [...ROWS.filter((r) => !(r.reform_id === "two_child_limit" && r.age_band === "16-24" && r.year === 2028)), row("two_child_limit", 2028, "16-24", 190, MIN_SAMPLE_SIZE - 1)];
    const { shown, noEffect, suppressed } = measureComparison(thin, POLICIES, ALL, 2028);
    expect(shown.map((point) => point.name)).toEqual(["Threshold freeze extension"]);
    expect(noEffect.map((policy) => policy.name)).toEqual(["Salary sacrifice cap"]);
    expect(suppressed).toEqual(["2 child limit repeal"]);
  });

  it("adds up mean changes by year and never reads a missing year as zero", () => {
    const points = changeByYear(ROWS, POLICIES, ["two_child_limit", "threshold_freeze_extension"], [2028, 2029, 2031]);
    expect(points[0]).toMatchObject({ year: 2028, published: true, "16-24": 30, all: 80 });
    expect(points[1]).toMatchObject({ "16-24": -110, all: -40 });
    // Missing group rows and thin rows are both unavailable.
    expect(points[1]["0-15"]).toBeNull();
    expect(points[2]).toMatchObject({ year: 2031, published: false, "16-24": null, all: null });
    const thin = changeByYear(
      [...ROWS, row("two_child_limit", 2029, "65+", 5, MIN_SAMPLE_SIZE - 1)],
      POLICIES,
      ALL,
      [2029],
    );
    expect(thin[0]["65+"]).toBeNull();
    expect(thin[0].suppressed).toEqual(["65+"]);
  });

  it("lists the groups a selected policy withholds in a year it publishes, never zero", () => {
    // A policy whose age bands are withheld (too few survey records) keeps
    // its all ages row: the bands are missing, all ages is still the sum
    const bands = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+"];
    const rows = [
      ...[2028, 2029].flatMap((year) => [...bands, "all"].map((band) => row("two_child_limit", year, band, 100))),
      ...bands.map((band) => row("threshold_freeze_extension", 2028, band, -40)),
      row("threshold_freeze_extension", 2028, "all", -40),
      row("threshold_freeze_extension", 2029, "all", -50),
    ];
    const [complete, withheld] = changeByYear(rows, POLICIES, ["two_child_limit", "threshold_freeze_extension"], [2028, 2029]);
    expect(complete).toMatchObject({ published: true, "16-24": 60, all: 60, missing: [], suppressed: [] });
    expect(withheld).toMatchObject({ published: true, all: 50, missing: bands, suppressed: [] });
    for (const band of bands) expect(withheld[band]).toBeNull();
    expect(missingGroupsNote([complete, withheld], (key) => key)).toBe(
      "Not drawn in 2029-30, as a selected policy has too few survey records by age: every age group except all ages.",
    );
    expect(missingGroupsNote([complete], (key) => key)).toBeNull();

    // The selection is a published combined package: its own rows, every
    // band drawn, though a single withholds them
    const pkg = "combined--abc";
    const packaged = [
      ...rows,
      ...[2028, 2029].flatMap((year) => [...bands, "all"].map((band) => row(pkg, year, band, year === 2028 ? 55 : 45))),
    ];
    const fromPackage = changeByYear(packaged, POLICIES, ["two_child_limit", "threshold_freeze_extension"], [2028, 2029, 2030], pkg);
    expect(fromPackage[1]).toMatchObject({ published: true, "16-24": 45, all: 45, missing: [], suppressed: [] });
    expect(fromPackage[0]["0-15"]).toBe(55);
    expect(fromPackage[2]).toMatchObject({ published: false, all: null });
    expect(missingGroupsNote(fromPackage, (key) => key)).toBeNull();
    // A package run with no rows loaded: the singles are summed as before
    expect(changeByYear(rows, POLICIES, ["two_child_limit", "threshold_freeze_extension"], [2029], pkg)[0].missing).toEqual(bands);
    // The focus group's series (headline, bars' net) reads the package too
    const series = groupSeries(packaged, POLICIES, ["two_child_limit", "threshold_freeze_extension"], [2028, 2029], "16-24", pkg);
    expect(series[0]).toMatchObject({ published: true, net: 55 });
    expect(series[0].parts.map((part) => part.value)).toEqual([100, -40]);
    expect(series[1]).toMatchObject({ published: true, net: 45, parts: [] });
  });

  it("says a run of years as a range, else lists them", () => {
    expect(yearList([2027, 2028, 2029, 2030, 2031])).toBe("2027-28 to 2031-32");
    expect(yearList([2027, 2029])).toBe("2027-28 and 2029-30");
    expect(yearList([2029])).toBe("2029-30");
  });

  it("never adds a missing, held or unknown selected measure as zero", () => {
    fc.assert(fc.property(fc.integer({ min: -10000, max: 10000 }), (value) => {
      const policies = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }];
      const rows = [row("alpha", 2029, "16-24", value), row("alpha", 2029, "22", value)];
      expect(changeByYear(rows, policies, ["alpha", "beta"], [2029])[0]["16-24"]).toBeNull();
      expect(changeByYear(rows, policies, ["alpha", "unknown"], [2029])[0]["16-24"]).toBeNull();
      expect(singleAgeBars(rows, policies, ["alpha", "unknown"], 2029)[12].netChange).toBeNull();
      const held = [{ ...policies[0], displayable: false }];
      expect(changeByYear(rows, held, ["alpha"], [2029])[0]["16-24"]).toBeNull();
      expect(singleAgeBars(rows, held, ["alpha"], 2029)[12].netChange).toBeNull();
      expect(measureComparison(rows, held, ["alpha"], 2029).shown).toEqual([]);
    }));
  });

  it("picks nice ticks that include zero", () => {
    expect(niceRange(-516, 0)).toEqual({ domain: [-600, 0], ticks: [-600, -400, -200, 0] });
    expect(niceRange(-330, 260).ticks).toContain(0);
    expect(wrapWords("Freeze student loan repayment thresholds", 16)).toEqual([
      "Freeze student",
      "loan repayment",
      "thresholds",
    ]);
  });
});

describe("young people cards", () => {
  const props = { rows: ROWS, policies: POLICIES, selectedPolicies: ALL, narrow: false, height: 400 };

  it("draws the policy comparison with a download menu and notes no-effect policies", () => {
    render(<MeasuresCard {...props} selectedYear={2028} />);
    expect(screen.getByRole("heading", { level: 3, name: /Effect of each policy, 2028-29/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download chart: Effect of each policy/ })).toBeInTheDocument();
    // The dumbbell is HTML, and still offers CSV, PNG and SVG
    expect(expectStandardDownloads(document.body)).toBe(1);
    // A row per policy: the group's value and its gap to all ages
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/vs all ages|≈ all ages/).length).toBeGreaterThan(0);
    // No effect: in the card's More info row, closed at first
    const more = screen.getByRole("button", { name: "About this chart" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    // One policy: the lead and its name on one line
    expect(document.querySelector(".no-effect")).toHaveTextContent(/^No effect in 2028-29: Salary sacrifice cap$/);
  });

  it("lets the reader choose the age group compared", () => {
    render(<MeasuresCard {...props} selectedYear={2028} />);
    // The age group is the card's one Options pill
    fireEvent.click(screen.getByRole("button", { name: /^Options: 16 to 24/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Compare" })).getByRole("radio", { name: /65 and over/ }));
    expect(screen.getByText(/65 and over vs all ages/)).toBeInTheDocument();
  });

  it("describes missing age-group rows as unavailable", () => {
    render(<MeasuresCard {...props} selectedYear={2028} />);
    // The age group is the card's one Options pill
    fireEvent.click(screen.getByRole("button", { name: /^Options: 16 to 24/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Compare" })).getByRole("radio", { name: /65 and over/ }));
    expect(screen.getByText("Results are unavailable for the selected policies in 2028-29.")).toBeInTheDocument();
    expect(screen.queryByText(/None of the selected policies changes/)).not.toBeInTheDocument();
  });

  it("shows a year with no rows as not yet published", () => {
    render(<MeasuresCard {...props} selectedYear={2031} />);
    expect(screen.getByText("Results for 2031-32 are not yet published.")).toBeInTheDocument();
  });

  it("takes its focus from By age's group: the compare option and the dumbbell follow it", () => {
    const { unmount } = render(<TrendCard {...props} selectedYear={2029} group="25-34" />);
    expect(screen.getByRole("button", { name: /^Options: 25 to 34 vs all/ })).toBeInTheDocument();
    unmount();
    render(<MeasuresCard {...props} selectedYear={2028} group="pensioners" />);
    expect(screen.getByRole("button", { name: /^Options: Pensioners/ })).toBeInTheDocument();
  });

  it("says a change of about £0 as almost no change, not a gain of £0", () => {
    render(<TrendCard {...props} selectedPolicies={["salary_sacrifice_cap"]} selectedYear={2028} />);
    const headline = document.querySelector(".trend-headline");
    expect(headline).toHaveTextContent(/^16 to 24-year-olds see almost no change in 2028-29/);
    expect(headline).not.toHaveTextContent(/gain about £0/);
  });

  it("says the headline as one plain sentence, the units folded in", () => {
    render(<TrendCard {...props} selectedYear={2028} />);
    const description = document.querySelector(".young-people-trend .chart-description");
    expect(description.querySelector("strong")).toBeNull();
    expect(description).toHaveTextContent(
      /^16 to 24-year-olds gain about £30 a person in 2028-29( and lose about £230 from 2029-30, when the [\w ]+ applies)?\.$/,
    );
    expect(description).not.toHaveTextContent(/£ a year/);
  });

  it("says which years a selected policy's age bands are withheld, under the chart", () => {
    const bands = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+"];
    const rows = [
      ...DISPLAY_YEARS.flatMap((year) => [...bands, "all"].map((band) => row("two_child_limit", year, band, 100))),
      ...DISPLAY_YEARS.map((year) => row("salary_sacrifice_cap", year, "all", -20)),
    ];
    render(<TrendCard {...props} rows={rows} selectedPolicies={["two_child_limit", "salary_sacrifice_cap"]} selectedYear={2029} />);
    expect(document.querySelector(".young-people-trend .chart-footer .note")).toHaveTextContent(
      `Not drawn in ${yearList(DISPLAY_YEARS)}, as a selected policy has too few survey records by age: every age group except all ages.`,
    );
  });

  it("draws every year shown, whatever year is selected", () => {
    render(<TrendCard {...props} selectedYear={2029} />);
    const first = DISPLAY_YEARS[0];
    const last = DISPLAY_YEARS[DISPLAY_YEARS.length - 1];
    const title = new RegExp(`Change by year, ${first}-${String(first + 1).slice(-2)} to ${last}-${String(last + 1).slice(-2)}`);
    expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download chart: Change by year/ })).toBeInTheDocument();
    expect(screen.getByTestId("recharts-responsive-container")).toBeInTheDocument();
  });
});

describe("single-year bars", () => {
  const aged = (age_band, mean_change, people = 100, sample_size = 500) => ({
    reform_id: "two_child_limit",
    year: 2029,
    age_band,
    mean_change,
    people,
    sample_size,
  });
  it("has one bar per age from 10 to 40, and none outside them", () => {
    const rows = [aged("9", 5), aged("10", -20), aged("22", 150), aged("40", 7), aged("41", 9), aged("90+", 30)];
    const bars = singleAgeBars(rows, POLICIES, ["two_child_limit"], 2029);
    expect([SINGLE_AGE_FIRST, SINGLE_AGE_LAST]).toEqual([10, 40]);
    expect(bars).toHaveLength(31);
    expect(bars[0]).toMatchObject({ age: 10, label: "10", netChange: -20 });
    expect(bars[12]).toMatchObject({ age: 22, label: "22", netChange: 150 });
    expect(bars[30]).toMatchObject({ age: 40, label: "40", netChange: 7 });
    expect(bars[11].netChange).toBeNull();
  });

  it("leaves an age out when its row is thin", () => {
    const thin = [aged("22", 150, 100, MIN_SAMPLE_SIZE - 1)];
    expect(singleAgeBars(thin, POLICIES, ["two_child_limit"], 2029)[12].netChange).toBeNull();
  });

  it("fits the axis to the data with a little headroom", () => {
    expect(fitRange(21, 944)).toEqual({ domain: [0, 1000], ticks: [0, 200, 400, 600, 800, 1000] });
    expect(fitRange(-1118, 821).domain).toEqual([-1200, 1200]);
    expect(fitRange(-1118, 821).ticks).toContain(0);
    // A maximum on a step still gets room above it
    expect(fitRange(0, 800).domain[1]).toBeGreaterThan(800);
  });
});

describe("the change-by-year helpers", () => {
  const row = (reform_id, year, mean_change) => ({ reform_id, year, age_band: "16-24", mean_change, sample_size: 500, people: 100 });
  const policies = [
    { id: "a", seriesKey: "measure:a", name: "A" },
    { id: "b", seriesKey: "measure:b", name: "B" },
  ];
  const rows = [
    row("a", 2026, 50), row("b", 2026, 10),
    row("a", 2027, 60), row("b", 2027, 10),
    row("a", 2028, 60), row("b", 2028, -200),
  ];

  it("adds each measure's own change for the group, and names the measure behind the big step", async () => {
    const { groupMeasureSeries, stepAnnotations, topParts, cumulate } = await import("./youngPeopleData");
    const series = groupMeasureSeries(rows, policies, ["a", "b"], [2026, 2027, 2028, 2029]);
    expect(series.map((point) => point.net)).toEqual([60, 70, -140, null]);
    expect(series[2]["measure:b"]).toBe(-200);
    // 2027-28 to 2028-29 falls by 210, from b alone; the 10 rise is too small to name
    expect(stepAnnotations(series)).toEqual([{ year: 2028, from: 2027, step: -210, value: -140, measureId: "b" }]);
    expect(topParts(series[2]).map((part) => part.id)).toEqual(["b", "a"]);
    // A running total stops at a gap, never reading it as zero
    expect(cumulate(series, ["net"]).map((point) => point.net)).toEqual([60, 130, -10, null]);
  });
});

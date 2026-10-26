import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MeasuresCard from "./MeasuresCard";
import TrendCard from "./TrendCard";
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
    // A row per policy: the group's value and its gap to all ages
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/vs all ages|≈ all ages/).length).toBeGreaterThan(0);
    // No effect: in the card's More info row, closed at first
    const more = screen.getByRole("button", { name: "More info" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getByText("No effect in 2028-29 (1)")).toBeInTheDocument();
    expect(screen.getByText("Salary sacrifice cap")).toBeInTheDocument();
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

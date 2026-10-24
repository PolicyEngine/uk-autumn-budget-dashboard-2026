import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderReact, screen } from "@testing-library/react";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./YoungPeopleSection";
import {
  meanChangeByBand,
  wholeSelectionRun,
  youngAndAll,
  MIN_SAMPLE_SIZE,
} from "../utils/ageImpact";
import { COMBINED_REFORM_ID } from "../utils/policyConfig";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

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
];
const ALL = POLICIES.map((policy) => policy.id);

const HEADER =
  "reform_id,reform_name,year,age_band,people,sample_size,mean_change,mean_equivalised_change,pct_better_off,pct_worse_off,pct_unchanged,people_directly_affected";

function row(id, band, { people = 1_000_000, sample = 5_000, mean = 0, better = 0, worse = 0, direct = 0 } = {}) {
  const unchanged = 100 - better - worse;
  return [id, id, 2029, band, people, sample, mean, mean / 2, better, worse, unchanged, direct].join(",");
}

const CSV = [
  HEADER,
  row("two_child_limit", "0-15", { mean: 300 }),
  row("two_child_limit", "16-24", { people: 7_500_000, mean: 100, better: 4 }),
  row("two_child_limit", "25-34", { mean: 120 }),
  row("two_child_limit", "35-49", { mean: 150 }),
  row("two_child_limit", "50-64", { mean: 10 }),
  row("two_child_limit", "65+", { mean: 5, sample: 50 }),
  row("two_child_limit", "all", { people: 70_000_000, mean: 120, better: 5 }),
  row("threshold_freeze_extension", "16-24", { people: 7_500_000, mean: -60, worse: 20, direct: 1_500_000 }),
  row("threshold_freeze_extension", "all", { people: 70_000_000, mean: -200, worse: 40, direct: 30_000_000 }),
  row(COMBINED_REFORM_ID, "16-24", { people: 7_500_000, mean: 40, better: 4, worse: 18, direct: 1_500_000 }),
  row(COMBINED_REFORM_ID, "all", { people: 70_000_000, mean: -80, better: 5, worse: 38, direct: 30_000_000 }),
].join("\n");

const catalogue = buildMeasureCatalogue({
  budgetary: [
    ...POLICIES.map((policy, index) => ({ reform_id: policy.id, reform_name: policy.name, value: index === 0 ? -1 : 1 })),
    { reform_id: COMBINED_REFORM_ID, reform_name: "All measures", value: 0 },
  ],
});
const render = (element) => renderReact(
  <MeasureCatalogueProvider catalogue={catalogue}>{element}</MeasureCatalogueProvider>,
);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => `${CSV}\n` })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("results by age", () => {
  it("adds up mean changes across policies, and hides thin bands", () => {
    const rows = [
      { reform_id: "two_child_limit", year: 2029, age_band: "16-24", mean_change: 100, sample_size: 5000 },
      { reform_id: "threshold_freeze_extension", year: 2029, age_band: "16-24", mean_change: -60, sample_size: 5000 },
      { reform_id: "two_child_limit", year: 2029, age_band: "65+", mean_change: 5, sample_size: MIN_SAMPLE_SIZE - 1 },
    ];
    const points = meanChangeByBand(rows, POLICIES, ALL, 2029);
    const young = points.find((point) => point.band === "16-24");
    expect(young["2 child limit repeal"]).toBe(100);
    expect(young["Threshold freeze extension"]).toBe(-60);
    expect(young.netChange).toBe(40);
    const oldest = points.find((point) => point.band === "65+");
    expect(oldest.suppressed).toBe(true);
    expect(oldest.netChange).toBeNull();
  });

  it("reads shares from one policy's run or the combined run only", () => {
    expect(wholeSelectionRun(POLICIES, ["two_child_limit"])).toBe("two_child_limit");
    expect(wholeSelectionRun(POLICIES, ALL)).toBe(COMBINED_REFORM_ID);
    const three = [...POLICIES, { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" }];
    expect(wholeSelectionRun(three, ALL)).toBeNull();
    expect(youngAndAll([], three, ALL, 2029)).toBeNull();
  });
});

describe("YoungPeopleSection", () => {
  it("has a linkable heading and the 16 to 24 headline figures", async () => {
    render(<YoungPeopleSection selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Young people (under 25)" });
    expect(heading.parentElement).toHaveAttribute("id", YOUNG_PEOPLE_ANCHOR);
    // All policies selected: the combined run's 1.5m of 7.5m
    expect(await screen.findByText("7.5m")).toBeInTheDocument();
    expect(screen.getByText("1.5m")).toBeInTheDocument();
    expect(screen.getByText(/20\.0% of them/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Average change by age, 2029-30/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Better and worse off, 2029-30/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("recharts-responsive-container")).toHaveLength(2);
  });

  it("says when the selection has no whole run, never showing zero", async () => {
    const three = [...POLICIES, { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" }];
    render(
      <YoungPeopleSection
        selectedPolicies={["two_child_limit", "threshold_freeze_extension"]}
        selectedYear={2029}
        policies={three}
      />,
    );
    expect(await screen.findByText(/shown for a single policy or for all policies\./)).toBeInTheDocument();
    expect(screen.getByText(/directly affected: shown for a single policy/)).toBeInTheDocument();
    // Only the mean change chart is drawn
    expect(screen.getAllByTestId("recharts-responsive-container")).toHaveLength(1);
  });

  it("shows a year with no rows as not yet published", async () => {
    render(<YoungPeopleSection selectedPolicies={ALL} selectedYear={2031} policies={POLICIES} />);
    expect(await screen.findAllByText("Results for 2031-32 are not yet published.")).toHaveLength(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, within } from "@testing-library/react";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./YoungPeopleSection";
import {
  meanChangeByBand,
  meanChangeBySingleAge,
  sharesByGroup,
  singleAgeKey,
  wholeSelectionRun,
  MIN_SAMPLE_SIZE,
} from "../utils/ageImpact";
import { changeByYear } from "./youngPeople/youngPeopleData";
// TEST DATA ONLY: the package run's id in these synthetic rows
const COMBINED_REFORM_ID = "autumn_budget_2026_combined";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

// Multiple chart cards and accessible queries need room in the shared jsdom runner.
vi.setConfig({ testTimeout: 30000 });

// The receipt route itself is tested in src/utils/publication/flat.test.js
// and src/hooks/useIncomeCurve.test.js; here the age table is served as the
// verified rows that route returns.
vi.mock("../utils/loadDashboard", async (importOriginal) => {
  const actual = await importOriginal();
  const { parseTable } = await import("../utils/publication/csv");
  const { isCatalogueRowDisplayable } = await import("../utils/measureCatalogue");
  return {
    ...actual,
    loadVerifiedTable: async (catalogue, table) => {
      const response = await fetch(`/data/${table}.csv`);
      if (!response.ok) throw new Error(`${table} is unavailable`);
      return parseTable(table, await response.text()).filter((row) =>
        isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
      );
    },
  };
});

vi.mock("recharts", () => {
  const Empty = () => null;
  const Chart = ({ children }) => <div>{children}</div>;
  return {
    ComposedChart: Chart, BarChart: Chart,
    ResponsiveContainer: ({ children }) => <div data-testid="recharts-responsive-container">{children}</div>,
    Bar: Empty, Cell: Empty, Scatter: Empty, CartesianGrid: Empty, Customized: Empty, LabelList: Empty,
    Legend: Empty, Line: Empty, ReferenceArea: Empty, ReferenceLine: Empty,
    Tooltip: Empty, XAxis: Empty, YAxis: Empty,
  };
});

const POLICIES = [
  { id: "two_child_limit", seriesKey: "measure:two_child_limit", name: "2 child limit repeal" },
  { id: "threshold_freeze_extension", seriesKey: "measure:threshold_freeze_extension", name: "Threshold freeze extension" },
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
  manifest: {
    measures: Object.fromEntries(POLICIES.map((policy) => [policy.id, { name: policy.name, status: "approved", years: [2029, 2031], unsupported_years: [], outputs_sha256: "a".repeat(64) }])),
    combined: { [COMBINED_REFORM_ID]: { name: "All measures", status: "approved", years: [2029, 2031], unsupported_years: [], measures: ALL, member_outputs_sha256: Object.fromEntries(ALL.map((id) => [id, "a".repeat(64)])) } },
  },
  budgetary: [
    ...POLICIES.map((policy, index) => ({ reform_id: policy.id, reform_name: policy.name, year: 2029, value: index === 0 ? -1 : 1 })),
    { reform_id: COMBINED_REFORM_ID, reform_name: "All measures", value: 0 },
  ],
  // Every key here stands for an artifact that verified
  tablesByKey: Object.fromEntries([...ALL, COMBINED_REFORM_ID].map((id) => [id, {}])),
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
    expect(young["measure:two_child_limit"]).toBe(100);
    expect(young["measure:threshold_freeze_extension"]).toBe(-60);
    expect(young.netChange).toBe(40);
    const oldest = points.find((point) => point.band === "65+");
    expect(oldest.suppressed).toBe(true);
    expect(oldest.netChange).toBeNull();
  });

  it("reads shares from one policy's run or the combined run only", () => {
    expect(wholeSelectionRun(POLICIES, ["two_child_limit"])).toBe("two_child_limit");
    expect(wholeSelectionRun(POLICIES, ALL, COMBINED_REFORM_ID)).toBe(COMBINED_REFORM_ID);
    expect(wholeSelectionRun(POLICIES, ALL)).toBeNull();
    const three = [...POLICIES, { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" }];
    expect(wholeSelectionRun(three, ALL)).toBeNull();
    expect(sharesByGroup([], three, ALL, 2029)).toBeNull();
  });

  it("gives every age group's shares from the whole run, thin groups left out", () => {
    const rows = [
      { reform_id: COMBINED_REFORM_ID, year: 2029, age_band: "16-24", sample_size: 5000, pct_better_off: 4 },
      { reform_id: COMBINED_REFORM_ID, year: 2029, age_band: "65+", sample_size: MIN_SAMPLE_SIZE - 1 },
      { reform_id: COMBINED_REFORM_ID, year: 2029, age_band: "all", sample_size: 50000, pct_better_off: 5 },
    ];
    const { run, groups } = sharesByGroup(rows, POLICIES, ALL, 2029, COMBINED_REFORM_ID);
    expect(run).toBe(COMBINED_REFORM_ID);
    expect(groups.map((group) => group.key)).toEqual(["0-15", "16-24", "25-34", "35-49", "50-64", "65+", "all"]);
    expect(groups.find((group) => group.key === "16-24").row.pct_better_off).toBe(4);
    expect(groups.find((group) => group.key === "65+").suppressed).toBe(true);
    expect(groups.find((group) => group.key === "0-15").suppressed).toBe(true);
  });

  it("adds up single years of age, leaving a gap where any policy has no row", () => {
    expect(singleAgeKey(17)).toBe("17");
    expect(singleAgeKey(90)).toBe("90+");
    const rows = [
      { reform_id: "two_child_limit", year: 2029, age_band: "17", mean_change: 100, sample_size: 300 },
      { reform_id: "threshold_freeze_extension", year: 2029, age_band: "17", mean_change: -40, sample_size: 300 },
      { reform_id: "two_child_limit", year: 2029, age_band: "18", mean_change: 90, sample_size: 300 },
      { reform_id: "two_child_limit", year: 2029, age_band: "90+", mean_change: 5, sample_size: 200 },
      { reform_id: "threshold_freeze_extension", year: 2029, age_band: "90+", mean_change: 1, sample_size: 200 },
    ];
    const points = meanChangeBySingleAge(rows, POLICIES, ALL, 2029);
    expect(points).toHaveLength(91);
    expect(points[17]).toMatchObject({ age: 17, label: "17", netChange: 60 });
    // 18 has no row for the threshold freeze
    expect(points[18].netChange).toBeNull();
    expect(points[90]).toMatchObject({ label: "90+", netChange: 6 });
    // One policy alone
    expect(meanChangeBySingleAge(rows, POLICIES, ["two_child_limit"], 2029)[18].netChange).toBe(90);
  });
});

describe("YoungPeopleSection", () => {
  it("has a linkable heading, no headline tiles and every card", async () => {
    render(<YoungPeopleSection selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />);
    const heading = await screen.findByRole("heading", { level: 2, name: "Change by age" });
    expect(heading.parentElement).toHaveAttribute("id", YOUNG_PEOPLE_ANCHOR);
    expect(
      await screen.findByRole("heading", { level: 3, name: /Average change by age, 2029-30/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/young people aged 16 to 24 in the UK/)).not.toBeInTheDocument();
    expect(screen.queryByText(/directly affected/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Better and worse off, 2029-30/ })).toBeInTheDocument();
    // Three Recharts charts; Effect of each policy is a dot plot of rows
    expect(screen.getAllByTestId("recharts-responsive-container")).toHaveLength(3);
  });

  it("switches average change by age to single years of age", async () => {
    render(<YoungPeopleSection selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />);
    // The view is the first choice in the card's one Options pill
    const card = (await screen.findByRole("heading", { level: 3, name: /^Average change by age/ })).closest(".young-people-mean");
    fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(within(card).getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: /By single year of age/ }));
    expect(screen.getByText(/by single year of age \(10 to 40\)/)).toBeInTheDocument();
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
    // Every chart but the shares is drawn (Effect of each policy as rows)
    expect(screen.getAllByTestId("recharts-responsive-container")).toHaveLength(2);
  });

  it("shows a year with no rows as not yet published", async () => {
    render(<YoungPeopleSection selectedPolicies={ALL} selectedYear={2031} policies={POLICIES} />);
    expect(await screen.findAllByText("Results for 2031-32 are not yet published.")).toHaveLength(3);
  });
});


it("keeps the age trend unavailable when a selected measure has no supported rows", () => {
  const rows = [
    { reform_id: "two_child_limit", year: 2029, age_band: "16-24", mean_change: 100, sample_size: 5000 },
    { reform_id: "two_child_limit", year: 2029, age_band: "all", mean_change: 120, sample_size: 5000 },
  ];
  expect(changeByYear(rows, POLICIES, ALL, [2029])[0]).toMatchObject({ year: 2029, published: false, suppressed: [], "16-24": null, all: null });
  const unknownSelection = meanChangeByBand(rows, [POLICIES[0]], [POLICIES[0].id, "unpublished_measure"], 2029);
  expect(unknownSelection.find((point) => point.band === "16-24").netChange).toBeNull();
});

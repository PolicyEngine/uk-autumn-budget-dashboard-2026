import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PensionersSection, { PENSIONER_EXAMPLE_LABEL } from "../PensionersSection";
import {
  aggregateFrom,
  pensionerAge,
  pensionerMeasures,
  pensionerShares,
  pensionerTrend,
} from "./pensionersData";
import { singleAgeBars, SINGLE_AGE_FIRST, SINGLE_AGE_LAST } from "../youngPeople/youngPeopleData";
import { SINGLE_AGE_TOP, singleAgeKey } from "../../utils/ageImpact";
import { COMBINED_REFORM_ID } from "../../utils/policyConfig";

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
  { id: "state_pension_income_tax_protection", name: "State Pension income tax protection" },
  { id: "threshold_freeze_2031_32", name: "Threshold freeze 2031-32" },
];
const ALL = POLICIES.map((policy) => policy.id);

// Every single age 50 to 90+, 2026 and 2027: pensioners gain £100 from
// the protection at every age from 66 (so 66 counts only in 2026), the
// freeze costs everyone £10, and 66-year-olds are twice as many as others.
function fixture() {
  const rows = [];
  for (const year of [2026, 2027]) {
    for (let age = 50; age <= SINGLE_AGE_TOP; age += 1) {
      const people = age === 66 ? 200 : 100;
      const base = { year, age_band: singleAgeKey(age), people, sample_size: 500 };
      rows.push({ ...base, reform_id: POLICIES[0].id, mean_change: age >= 66 ? 100 : 0, pct_better_off: age >= 66 ? 50 : 0, pct_unchanged: age >= 66 ? 50 : 100, pct_worse_off: 0 });
      rows.push({ ...base, reform_id: POLICIES[1].id, mean_change: -10, pct_better_off: 0, pct_unchanged: 0, pct_worse_off: 100 });
      rows.push({ ...base, reform_id: COMBINED_REFORM_ID, mean_change: age >= 66 ? 90 : -10, pct_better_off: age >= 66 ? 40 : 0, pct_unchanged: 0, pct_worse_off: age >= 66 ? 60 : 100 });
    }
    for (const policy of [...POLICIES, { id: COMBINED_REFORM_ID }]) {
      rows.push({ reform_id: policy.id, year, age_band: "all", people: 10_000, sample_size: 50_000, mean_change: 20, pct_better_off: 20, pct_unchanged: 0, pct_worse_off: 80 });
    }
  }
  return rows;
}

describe("pensioners data", () => {
  it("counts people at or over State Pension age: 66 in 2026-27, 67 from 2027-28", () => {
    expect(pensionerAge(2026)).toBe(66);
    expect(pensionerAge(2027)).toBe(67);
    expect(pensionerAge(2031)).toBe(67);
  });

  it("weights single ages by people, and drops the whole group on a missing or thin age", () => {
    const rows = fixture();
    // 2026: ages 66 (200 people) to 90+ (24 ages of 100): all £100
    expect(aggregateFrom(rows, POLICIES[0].id, 2026, 66)).toMatchObject({ people: 200 + 24 * 100, mean_change: 100 });
    // From 60: 6 ages at £0 (600 people) and 2,600 people at £100
    expect(aggregateFrom(rows, POLICIES[0].id, 2026, 60).mean_change).toBeCloseTo((2600 * 100) / 3200);
    const thin = rows.map((row) => (row.age_band === "80" ? { ...row, sample_size: 10 } : row));
    expect(aggregateFrom(thin, POLICIES[0].id, 2026, 66)).toBeNull();
    const gap = rows.filter((row) => row.age_band !== "75");
    expect(aggregateFrom(gap, POLICIES[0].id, 2026, 66)).toBeNull();
  });

  it("adds each policy's change per pensioner, year by year", () => {
    const [y2026, y2027, y2028] = pensionerTrend(fixture(), POLICIES, ALL, [2026, 2027, 2028]);
    expect(y2026.netChange).toBeCloseTo(90);
    expect(y2027.netChange).toBeCloseTo(90);
    expect(y2027.parts.map((part) => part.id)).toEqual(ALL);
    expect(y2028).toMatchObject({ published: false, netChange: null });
  });

  it("compares each policy for pensioners with all ages", () => {
    const { shown } = pensionerMeasures(fixture(), POLICIES, ALL, 2027);
    expect(shown[0]).toMatchObject({ id: POLICIES[0].id, group: 100, all: 20 });
    expect(shown[1]).toMatchObject({ id: POLICIES[1].id, group: -10, all: 20 });
  });

  it("splits better and worse off into pensioners, the rest and all ages, from one run", () => {
    const shares = pensionerShares(fixture(), POLICIES, ALL, 2027);
    expect(shares.run).toBe(COMBINED_REFORM_ID);
    const [pensioners, under, all] = shares.groups;
    expect(pensioners.row.pct_better_off).toBeCloseTo(40);
    // The rest: (10,000 × 20% − 2,400 × 40%) / 7,600
    expect(under.row.people).toBe(10_000 - 2_400);
    expect(under.row.pct_better_off).toBeCloseTo((2000 - 960) / 7600 * 100);
    expect(all.row.pct_better_off).toBe(20);
    // No run for part of the selection
    expect(pensionerShares(fixture(), [...POLICIES, { id: "x", name: "X" }], ALL, 2027)).toBeNull();
  });

  it("leaves Young people's single-age bars as they were", () => {
    const rows = fixture();
    const young = singleAgeBars(rows, POLICIES, ALL, 2026);
    expect(young[0].age).toBe(SINGLE_AGE_FIRST);
    expect(young[young.length - 1].age).toBe(SINGLE_AGE_LAST);
    const old = singleAgeBars(rows, POLICIES, ALL, 2026, 85, SINGLE_AGE_TOP);
    expect(old.map((bar) => bar.label)).toEqual(["85", "86", "87", "88", "89", "90+"]);
    expect(old[5].netChange).toBeCloseTo(90);
  });
});

const HEADER =
  "reform_id,reform_name,year,age_band,people,sample_size,mean_change,mean_equivalised_change,pct_better_off,pct_worse_off,pct_unchanged,people_directly_affected";
const toCsv = (rows) =>
  [
    HEADER,
    ...rows.map((row) =>
      [row.reform_id, row.reform_id, row.year, row.age_band, row.people, row.sample_size, row.mean_change, row.mean_change, row.pct_better_off, row.pct_worse_off, row.pct_unchanged, 0].join(","),
    ),
  ].join("\n");

describe("PensionersSection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `${toCsv(fixture())}\n` })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders its four cards from the data, defines pensioners once and links to the example household", async () => {
    const onOpenHousehold = vi.fn();
    render(
      <PensionersSection
        selectedPolicies={ALL}
        selectedYear={2027}
        policies={POLICIES}
        onOpenHousehold={onOpenHousehold}
      />,
    );
    expect(await screen.findByRole("heading", { name: /Change per pensioner by year/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Change by age, 2027-28/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Effect of each policy, 2027-28/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Better and worse off, 2027-28/ })).toBeInTheDocument();
    expect(document.body.textContent.match(/at or over State Pension age/g)).toHaveLength(1);
    // The dumbbell's rows: pensioners' figure for each policy
    expect(
      screen.getByRole("row", { name: /State Pension income tax protection: Pensioners £100, all ages £20/ }),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(PENSIONER_EXAMPLE_LABEL);
    fireEvent.click(screen.getByRole("link", { name: "Household impact" }));
    expect(onOpenHousehold).toHaveBeenCalledTimes(1);
  });
});

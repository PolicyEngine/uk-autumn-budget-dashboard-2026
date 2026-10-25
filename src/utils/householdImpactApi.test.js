import { describe, expect, it } from "vitest";
import {
  atStatePensionAge,
  buildHouseholdRequest,
  consistentRound,
  normaliseHouseholdImpact,
  requestKey,
  statePensionFor,
} from "./householdImpactApi";
import {
  areaName,
  groupTotals,
  headlineVerb,
  pinnedRound,
  policyRows,
  programmeGroups,
  programmeNotes,
  roundProgrammeGroups,
} from "./singleYear";
import { headlineTotals } from "../components/personal/SingleYearResults";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { DEFAULT_SALARY, REGIONAL_RENT } from "./householdDefaults";
import { HOUSEHOLD_FIXTURE } from "../test/householdFixture";
import { POLICIES_FOR_TEST } from "../test/personalPolicies";

describe("buildHouseholdRequest", () => {
  it("asks 16- to 19-year-olds' education, yes until answered, and keeps a child of 20 for the API to refuse", () => {
    const body = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, children_ages: "15, 16, 18, 19, 20", children_in_education: [true, true, false] },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(body.household.children).toEqual([
      { age: 15 },
      { age: 16, in_education: true },
      { age: 18, in_education: false },
      { age: 19, in_education: true },
      { age: 20 },
    ]);
  });

  it("sends private pensions, the partner's only with a partner", () => {
    const single = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, private_pension_per_year: 10000, partner_private_pension_per_year: 5000 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(single.household.private_pension_income).toBe(10000);
    expect(single.household.partner_private_pension_income).toBe(0);
    const couple = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, has_partner: true, partner_private_pension_per_year: 5000 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(couple.household.private_pension_income).toBe(0);
    expect(couple.household.partner_private_pension_income).toBe(5000);
  });


  it("sends rent only for renters and childcare only with children", () => {
    const owner = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, tenure: "OWNED_OUTRIGHT", monthly_rent: 900, monthly_childcare: 400 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(owner.household.monthly_rent).toBe(0);
    expect(owner.household.monthly_childcare).toBe(0);
    const family = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, children_ages: "4, 7", monthly_childcare: 400, has_partner: true },
      { year: 2029, policies: ["two_child_limit"], include: ["by_policy"] },
    );
    // Rent left as prefilled: the region's average private rent (ONS)
    expect(family.household).toMatchObject({
      children: [{ age: 4 }, { age: 7 }],
      monthly_childcare: 400,
      region: "NORTH_WEST",
      monthly_rent: REGIONAL_RENT.NORTH_WEST,
      partner_employment_income: DEFAULT_SALARY,
    });
    const entered = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, region: "LONDON", monthly_rent: 1200 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(entered.household.monthly_rent).toBe(1200);
    const london = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, region: "LONDON" },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(london.household.monthly_rent).toBe(REGIONAL_RENT.LONDON);
    expect(family.include).toEqual(["by_policy"]);
    // Only fields the API's HouseholdAnswersRequest takes (it refuses others)
    expect(Object.keys(family.household).sort()).toEqual(
      [
        "age",
        "employment_income",
        "has_partner",
        "partner_age",
        "partner_employment_income",
        "children",
        "region",
        "claims_universal_credit",
        "tenure",
        "monthly_rent",
        "dividend_income",
        "electricity_spending",
        "savings_interest_income",
        "property_income",
        "private_pension_income",
        "partner_private_pension_income",
        "petrol_spending",
        "diesel_spending",
        "salary_sacrifice_pension_contributions",
        "student_loan_plan",
        "council_tax_band",
        "monthly_childcare",
        "salary_year",
      ].sort(),
    );
    // The stage is not part of the cache key
    expect(requestKey(family)).toBe(requestKey({ ...family, include: [] }));
  });

  it("sends a State Pension only as entered, and only at State Pension age", () => {
    const { age, full } = statePensionFor(2029);
    expect(age).toBe(67);
    expect(full).toBeCloseTo(13696.98, 2);
    expect(atStatePensionAge(67, 2029)).toBe(true);
    expect(atStatePensionAge(66, 2029)).toBe(false);
    expect(atStatePensionAge(66, 2026)).toBe(true);
    const options = { year: 2029, policies: ["two_child_limit"] };
    // Left as prefilled: not sent, so the API uses the year's full rate
    const prefilled = buildHouseholdRequest({ ...WIZARD_DEFAULTS, current_age: 72 }, options);
    expect(prefilled.household).not.toHaveProperty("state_pension");
    const entered = buildHouseholdRequest(
      {
        ...WIZARD_DEFAULTS,
        current_age: 72,
        state_pension_per_year: 9000,
        has_partner: true,
        partner_age: 70,
        partner_state_pension_per_year: 6000,
      },
      options,
    );
    expect(entered.household).toMatchObject({ state_pension: 9000, partner_state_pension: 6000 });
    // Under State Pension age, or with no partner, it is not sent
    const young = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, current_age: 66, state_pension_per_year: 9000, partner_state_pension_per_year: 6000 },
      options,
    );
    expect(young.household).not.toHaveProperty("state_pension");
    expect(young.household).not.toHaveProperty("partner_state_pension");
  });
});

describe("consistentRound", () => {
  it("rounds rows so they add up to the rounded total", () => {
    // Naive rounding gives 0 + 0 + 0 = 0, not 1
    expect(consistentRound([0.4, 0.4, 0.4], 1.2)).toEqual([1, 0, 0]);
    expect(consistentRound([-0.4, -0.4, -0.4], -1.2)).toEqual([-1, 0, 0]);
    const rounded = consistentRound([-143.64, -147.15, -36, 40], -286.79);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(-287);
  });
});

describe("normaliseHouseholdImpact", () => {
  it("reads the API's answer: baseline and reform, the salary used, and each part", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    expect(data.net).toEqual({ before: 65370.9, after: 69135.74, change: 3764.84 });
    expect(data.salaryUsed).toBe(34192.26);
    expect(data.partnerSalaryUsed).toBe(12822.1);
    expect(data.notModelled).toEqual([expect.objectContaining({ id: "rail_fares_freeze", name: "Rail fares freeze" })]);
    expect(data.byPolicy.measures).toHaveLength(8);
    expect(data.byPolicy.residual).toBe(0.04);
    expect(data.sweep.points).toHaveLength(50);
    expect(data.sweep.rates).toHaveLength(49);
    expect(data.sweep.max).toBe(150000);
    expect(data.sweep.own).toMatchObject({ income: 34192.26, after: 69135.74, afterRate: 0.6765 });
    expect(data.area).toEqual({ region: "NORTH_WEST", brma: "CENTRAL_GREATER_MANCHESTER", brmaDefault: true });
    expect(data.engine.policyengine).toBeTruthy();
    // The headline stage: the slow parts are null, not missing
    const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, by_policy: null, sweep: null });
    expect(headline.byPolicy).toBeNull();
    expect(headline.sweep).toBeNull();
  });
});

describe("policyRows", () => {
  const POLICIES = POLICIES_FOR_TEST;
  const measure = (id, change) => ({ id, change, status: change === 0 ? "not_affected" : "affected" });

  it("gives each measure its own bar, adding up to the tile, from the fixture", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const change = Math.round(data.net.after) - Math.round(data.net.before);
    const { rows, noEffect, underAPound } = policyRows(data.byPolicy, change, POLICIES);
    expect(rows.map((row) => [row.id, row.rounded])).toEqual([
      ["two_child_limit", 3882],
      ["threshold_freeze_extension", -95],
      ["salary_sacrifice_cap", -24],
      ["fuel_duty_freeze", 2],
    ]);
    expect(rows.reduce((sum, row) => sum + row.rounded, 0)).toBe(change);
    // The residual (4p) is under £1: no interaction row
    expect(rows.some((row) => row.id === "interaction")).toBe(false);
    expect(noEffect).toContain("Dividend tax increase (+2pp)");
    expect(underAPound).toEqual([]);
  });

  it("shows the interaction between policies from £1, so the bars still add up", () => {
    const byPolicy = {
      measures: [measure("threshold_freeze_extension", -100.4), measure("two_child_limit", 400.2), measure("fuel_duty_freeze", 0)],
      residual: -20.3,
    };
    const { rows, noEffect } = policyRows(byPolicy, 279.5, POLICIES);
    expect(rows.map((row) => [row.name, row.rounded])).toEqual([
      ["2 child limit repeal", 400],
      ["Threshold freeze extension", -100],
      ["Interaction between policies", -20],
    ]);
    expect(noEffect).toEqual(["Fuel duty freeze extension"]);
    const small = policyRows({ ...byPolicy, residual: 0.6 }, 300.4, POLICIES);
    expect(small.rows.some((row) => row.id === "interaction")).toBe(false);
    expect(small.rows.reduce((sum, row) => sum + row.rounded, 0)).toBe(300);
  });

  it("notes an employer cost apart from no effect, and the Warm Home Discount if received", () => {
    const byPolicy = normaliseHouseholdImpact({
      ...HOUSEHOLD_FIXTURE,
      by_policy: {
        measures: [
          {
            id: "employer_ni_relief_under_25s",
            name: "Employer NI relief for under-25s",
            change: 0,
            status: "not_affected",
            note: "No household effect (employer cost): wages are held fixed.",
            note_kind: "employer_cost",
          },
          {
            id: "warm_home_discount_top_up",
            name: "Warm Home Discount top-up",
            change: 100,
            status: "affected",
            note: "If received: £100.",
            note_kind: "if_received",
          },
        ],
        combined: 100,
        sum_of_singles: 100,
        residual: 0,
      },
    }).byPolicy;
    const { rows, noEffect, notes } = policyRows(byPolicy, 100, POLICIES);
    expect(rows.map((row) => [row.id, row.rounded])).toEqual([["warm_home_discount_top_up", 100]]);
    expect(noEffect).toEqual([]);
    expect(notes.map((note) => [note.id, note.kind])).toEqual([
      ["employer_ni_relief_under_25s", "employer_cost"],
      ["warm_home_discount_top_up", "if_received"],
    ]);
    expect(notes[0].text).toMatch(/^No household effect \(employer cost\)/);
    // Not received: no "if received" note
    const none = policyRows(
      { ...byPolicy, measures: byPolicy.measures.map((row) => ({ ...row, change: 0, status: "not_affected" })) },
      0,
      POLICIES,
    );
    expect(none.notes.map((note) => note.id)).toEqual(["employer_ni_relief_under_25s"]);
  });

  it("lists a measure worth under £1 apart from those with no effect", () => {
    const { rows, underAPound } = policyRows(
      { measures: [measure("two_child_limit", 50), measure("fuel_duty_freeze", 0.3)], residual: 0 },
      50.3,
      POLICIES,
    );
    expect(rows.map((row) => row.id)).toEqual(["two_child_limit"]);
    expect(underAPound).toEqual(["Fuel duty freeze extension"]);
  });
});

describe("consistentRound", () => {
  it("does not move a row by more than £1", () => {
    expect(consistentRound([3881.89, -95.05, -24.42, 2.37], 3765)).toEqual([3882, -95, -24, 2]);
  });
});

describe("programmeGroups", () => {
  it("shows taxes as negative amounts, in sentence case, and hides rows that are £0 throughout", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const groups = programmeGroups(data.programmes);
    // Spring Statement's top rows, in its order; pension contributions from
    // pay are a row of their own when the household has them
    expect(groups.map((group) => group.label)).toEqual(["Market income", "Taxes", "Benefits"]);
    const tax = groups.find((group) => group.id === "tax").rows.find((row) => row.id === "income_tax");
    expect(tax.label).toBe("Income tax");
    expect(tax.before).toBeCloseTo(-4163.65);
    expect(tax.change).toBeCloseTo(-196.18);
    const ids = groups.flatMap((group) => group.rows).map((row) => row.id);
    expect(ids).not.toContain("housing_benefit");
    // 4p of other taxes rounds to £0 and is hidden
    expect(ids).not.toContain("other_taxes");
    expect(ids).toContain("free_childcare");
  });

  it("adds up to the tiles' net income, before and after", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const all = data.programmes;
    const sign = { tax: -1, benefit: 1, income: 1 };
    for (const side of ["before", "after"]) {
      const total = all.reduce((sum, row) => sum + sign[row.group] * row[side], 0);
      expect(total).toBeCloseTo(data.net[side], 1);
    }
  });

  it("keeps a note only for a row it shows", () => {
    const groups = programmeGroups(normaliseHouseholdImpact(HOUSEHOLD_FIXTURE).programmes);
    expect(programmeNotes(groups).map((item) => item.id)).toEqual(["employment_income", "fuel_duty", "universal_credit", "free_childcare"]);
  });

  it("drops employment income's pay-cut note in a year without the pay cut", () => {
    const programmes = HOUSEHOLD_FIXTURE.programmes.map((row) =>
      row.id === "employment_income"
        ? { ...row, reform: row.baseline, change: 0, children: row.children.map((child) => ({ ...child, reform: 0, change: 0 })) }
        : row,
    );
    const groups = programmeGroups(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, programmes }).programmes);
    expect(programmeNotes(groups).map((item) => item.id)).not.toContain("employment_income");
  });
});

describe("the programme table's whole pounds", () => {
  // A pensioner: fuel duty falls by £3.60 under the freeze, income tax rises
  // by £2.40 under the dividend rate. Each rounded on its own, the table
  // said +£4 and −£2 against a tile of +£1, and fuel duty's bar said +£3.
  const byPolicy = {
    measures: [
      { id: "fuel_duty_freeze", name: "Fuel duty freeze", change: 3.6, status: "affected" },
      { id: "dividend_tax_increase_2pp", name: "Dividend tax", change: -2.4, status: "affected" },
    ],
    residual: 0,
  };
  const programmes = [
    { id: "income_tax", group: "tax", before: 43.75, after: 46.15, children: [] },
    { id: "fuel_duty", group: "tax", before: 339.49, after: 335.89, children: [] },
    { id: "state_pension", group: "benefit", before: 13696.98, after: 13696.98, children: [] },
    { id: "dividend_income", group: "income", before: 1000, after: 1000, children: [] },
  ];
  const net = { before: 14313.74, after: 14314.94 };

  it("adds up to the tiles and shows a policy's change as its bar does", () => {
    const totals = headlineTotals(net);
    expect(totals.change).toBe(1);
    const bars = policyRows(byPolicy, totals.change, POLICIES_FOR_TEST);
    const fuelBar = bars.all.find((row) => row.id === "fuel_duty_freeze").rounded;
    const groups = roundProgrammeGroups(programmeGroups(programmes), totals, bars.all);
    const rows = groups.flatMap((group) => group.rows);
    const fuel = rows.find((row) => row.id === "fuel_duty");
    const tax = rows.find((row) => row.id === "income_tax");
    expect(fuel.shown.change).toBe(fuelBar);
    expect(tax.shown.change).toBe(bars.all.find((row) => row.id === "dividend_tax_increase_2pp").rounded);
    for (const side of ["before", "after", "change"]) {
      expect(rows.reduce((sum, row) => sum + row.shown[side], 0)).toBe(totals[side]);
    }
    for (const row of rows) expect(row.shown.after).toBe(row.shown.before + row.shown.change);
  });

  it("adds up to the tiles before the split by policy is in", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const totals = headlineTotals(data.net);
    const groups = roundProgrammeGroups(programmeGroups(data.programmes), totals);
    const rows = groups.flatMap((group) => group.rows);
    for (const side of ["before", "after", "change"]) {
      expect(rows.reduce((sum, row) => sum + row.shown[side], 0)).toBe(totals[side]);
    }
    for (const row of rows) {
      expect(row.shown.after).toBe(row.shown.before + row.shown.change);
      expect(Math.abs(row.shown.change - row.change)).toBeLessThan(1.5);
    }
    // Income tax's parts add up to it
    const tax = rows.find((row) => row.id === "income_tax");
    expect(tax.children.reduce((sum, child) => sum + child.shown.change, 0)).toBe(tax.shown.change);
  });

  it("pins each bar to one row at most, and falls back when pins cannot reach the total", () => {
    const bars = [{ id: "a", change: 3.5, rounded: 3 }];
    expect(pinnedRound([3.5, 3.5], 7, bars)).toEqual([3, 4]);
    // The only row pinned to £3 but the tile says £4: plain rounding instead
    expect(pinnedRound([3.5], 4, bars)).toEqual([4]);
  });

  it("pins a row a penny off its bar (the API rounds each amount to the penny)", () => {
    // A couple in 2031-32: fuel duty's row +£4.60, its bar +£4.61 (£4)
    const byPolicy = {
      measures: [
        { id: "two_child_limit", change: 4038.71, status: "affected" },
        { id: "threshold_freeze_extension", change: -107.11, status: "affected" },
        { id: "salary_sacrifice_cap", change: -18.75, status: "affected" },
        { id: "fuel_duty_freeze", change: 4.61, status: "affected" },
      ],
      residual: 0,
    };
    const bars = policyRows(byPolicy, 3917, POLICIES_FOR_TEST);
    expect(bars.all.find((row) => row.id === "fuel_duty_freeze").rounded).toBe(4);
    const rounded = pinnedRound([-158.42, -63.39, 4.6, 4192.54, -57.88], 3917, bars.all);
    expect(rounded[2]).toBe(4);
    expect(rounded.reduce((sum, value) => sum + value, 0)).toBe(3917);
    // Rounded on its own the row would be £5 against the bar's £4
    expect(pinnedRound([4.6, 10.4], 15, [{ id: "fuel_duty_freeze", change: 4.61, rounded: 4 }])).toEqual([4, 11]);
  });
});

describe("areaName", () => {
  it("names a rent area from the API's BRMA", () => {
    expect(areaName("INNER_SOUTH_EAST_LONDON")).toBe("Inner South East London");
    expect(areaName(null)).toBeNull();
  });
});

describe("the breakdown's top rows", () => {
  it("add up to net income before and after, with pension contributions on their own", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const totals = headlineTotals(data.net);
    const groups = groupTotals(roundProgrammeGroups(programmeGroups(data.programmes), totals));
    for (const side of ["before", "after", "change"]) {
      expect(groups.reduce((sum, group) => sum + group.shown[side], 0)).toBe(totals[side]);
    }
    const programmes = [
      ...HOUSEHOLD_FIXTURE.programmes,
      { id: "pension_contributions", group: "tax", baseline: 1200, reform: 1200, change: 0, children: [] },
    ];
    const withPension = programmeGroups(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, programmes }).programmes);
    const pension = withPension.find((group) => group.id === "pension");
    expect(pension.label).toBe("Pension contributions");
    expect(pension.rows[0].before).toBe(-1200);
    expect(withPension.find((group) => group.id === "tax").rows.map((row) => row.id)).not.toContain(
      "pension_contributions",
    );
  });

  it("words the headline as Spring Statement does", () => {
    expect(headlineVerb(103)).toBe("raise");
    expect(headlineVerb(-570)).toBe("lower");
    expect(headlineVerb(0)).toBe("not change");
  });
});

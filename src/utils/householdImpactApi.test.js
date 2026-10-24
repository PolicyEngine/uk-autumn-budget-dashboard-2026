import { describe, expect, it } from "vitest";
import {
  buildHouseholdRequest,
  consistentRound,
  normaliseHouseholdImpact,
  requestKey,
} from "./householdImpactApi";
import { policyRows, programmeGroups } from "./singleYear";
import { WIZARD_DEFAULTS } from "../components/LifecycleCalculator";
import { HOUSEHOLD_FIXTURE } from "../test/householdFixture";
import { POLICIES_FOR_TEST } from "../test/personalPolicies";

describe("buildHouseholdRequest", () => {
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
    expect(family.household).toMatchObject({
      children_ages: [4, 7],
      monthly_childcare: 400,
      monthly_rent: 900,
      partner_employment_income: 25000,
    });
    expect(family.include).toEqual(["by_policy"]);
    // The stage is not part of the cache key
    expect(requestKey(family)).toBe(requestKey({ ...family, include: [] }));
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

describe("policyRows", () => {
  it("adds up to the total, and shows an unexplained remainder as its own row", () => {
    const exact = policyRows(
      [
        { id: "threshold_freeze_extension", change: -100.4 },
        { id: "fuel_duty_freeze", change: 30.3 },
        { id: "two_child_limit", change: 0 },
      ],
      -70,
      POLICIES_FOR_TEST,
    );
    expect(exact.rows.map((row) => row.rounded).reduce((a, b) => a + b, 0)).toBe(-70);
    expect(exact.noEffect).toEqual(["2 child limit repeal"]);

    const leftover = policyRows([{ id: "threshold_freeze_extension", change: -100 }], -120, POLICIES_FOR_TEST);
    expect(leftover.rows.map((row) => [row.name, row.rounded])).toEqual([
      ["Threshold freeze extension", -100],
      ["Interaction between policies", -20],
    ]);
  });
});

describe("programmeGroups", () => {
  it("shows taxes as negative amounts and hides rows that are £0 throughout", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const groups = programmeGroups(data.programmes);
    expect(groups.map((group) => group.label)).toEqual(["Taxes", "Benefits", "Earnings and other income"]);
    const tax = groups[0].rows.find((row) => row.id === "income_tax");
    expect(tax.before).toBe(-3846);
    expect(tax.change).toBeCloseTo(-228);
    expect(groups.flatMap((group) => group.rows).some((row) => row.id === "housing_benefit")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildBudgetData } from "./budgetData";
import { DISPLAY_YEARS } from "./displayYears";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
];
const BOTH = POLICIES.map((policy) => policy.id);

// Invented figures, in £bn, as budgetary_impact.csv rows
const row = (reformId, year, value) => ({
  reform_id: reformId,
  year: String(year),
  value: String(value),
});

describe("the revenue chart's data", () => {
  it("has one point per year the dashboard shows, from budget_years.json", () => {
    const points = buildBudgetData([row("two_child_limit", 2027, -3)], POLICIES, BOTH);
    expect(points.map((point) => point.year)).toEqual(DISPLAY_YEARS);
    expect(DISPLAY_YEARS).toContain(2031);
  });

  it("charts 2031-32 once the published files have it", () => {
    const rows = [row("two_child_limit", 2031, -3.5), row("fuel_duty_freeze", 2031, -1)];
    const point = buildBudgetData(rows, POLICIES, BOTH).find(
      (candidate) => candidate.year === 2031,
    );
    expect(point.unpublished).toBeUndefined();
    expect(point["2 child limit repeal"]).toBe(-3.5);
    expect(point.netImpact).toBeCloseTo(-4.5);
  });

  it("leaves a year the files lack as not yet published, never zero", () => {
    const point = buildBudgetData([row("two_child_limit", 2030, -3)], POLICIES, BOTH).find(
      (candidate) => candidate.year === 2031,
    );
    expect(point).toEqual({ year: 2031, netImpact: null, unpublished: true });
  });

  it("adds up only the selected policies", () => {
    const rows = [row("two_child_limit", 2029, -3), row("fuel_duty_freeze", 2029, -1)];
    const point = buildBudgetData(rows, POLICIES, ["fuel_duty_freeze"]).find(
      (candidate) => candidate.year === 2029,
    );
    expect(point["2 child limit repeal"]).toBe(0);
    expect(point["Fuel duty freeze extension"]).toBe(-1);
    expect(point.netImpact).toBe(-1);
  });
});

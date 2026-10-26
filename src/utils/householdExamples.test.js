import { describe, expect, it } from "vitest";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { POLICIES } from "./policies";
import { EXAMPLE_ICONS } from "../components/personal/HouseholdCards";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest } from "./householdImpactApi";

describe("the example households", () => {
  it("are seven, with unique ids, a name, a one-line description, a measure and an icon each", () => {
    expect(HOUSEHOLD_EXAMPLES).toHaveLength(7);
    const ids = HOUSEHOLD_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of HOUSEHOLD_EXAMPLES) {
      expect(example.label.length).toBeGreaterThan(0);
      expect(example.description.length).toBeGreaterThan(0);
      expect(example.description.length).toBeLessThanOrEqual(60);
      expect(example.note.length).toBeGreaterThan(0);
      // The measure it is for: a real one, named short enough for a tag
      expect(POLICIES.map((policy) => policy.id), example.id).toContain(example.measure);
      expect(example.tag.length, example.id).toBeLessThanOrEqual(25);
      expect(Object.keys(EXAMPLE_ICONS), example.id).toContain(example.icon);
    }
  });

  it("set only the form's own answers, and each makes a valid household request", () => {
    for (const example of HOUSEHOLD_EXAMPLES) {
      for (const key of Object.keys(example.inputs)) {
        expect(Object.keys(WIZARD_DEFAULTS), `${example.id}: ${key}`).toContain(key);
      }
      const body = buildHouseholdRequest(
        { ...WIZARD_DEFAULTS, ...example.inputs },
        { year: 2027, policies: ["road_fuel_vat_cut"] },
      );
      expect(body.household.age, example.id).toBe(example.inputs.current_age);
      expect(body.household.employment_income, example.id).toBe(example.inputs.current_salary);
    }
  });

  it("use neutral wording", () => {
    const text = HOUSEHOLD_EXAMPLES.map((example) => `${example.label} ${example.description} ${example.note}`).join(" ");
    expect(text).not.toMatch(/\\b(poor|rich|wealthy)\\b/i);
  });
});

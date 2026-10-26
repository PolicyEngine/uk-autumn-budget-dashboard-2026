import { describe, expect, it } from "vitest";
import { EXAMPLE_GROUPS, HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest } from "./householdImpactApi";
import { SELECTABLE_YEARS } from "./displayYears";
import { fiscalYearTick } from "./chartTheme";

describe("the example households", () => {
  it("come in two groups, with unique ids, a name and a one-line description each", () => {
    expect(EXAMPLE_GROUPS.map((group) => group.title)).toEqual(["Young people", "Other households"]);
    const ids = HOUSEHOLD_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of HOUSEHOLD_EXAMPLES) {
      expect(example.label.length).toBeGreaterThan(0);
      expect(example.description.length).toBeGreaterThan(0);
      expect(example.description.length).toBeLessThanOrEqual(60);
      expect(example.note.length).toBeGreaterThan(0);
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

  it("never point to a year the year pill does not offer", () => {
    const offered = SELECTABLE_YEARS.map((year) => fiscalYearTick(year));
    for (const example of HOUSEHOLD_EXAMPLES) {
      const text = `${example.description} ${example.note}`;
      for (const [, label] of text.matchAll(/choose (\d{4}-\d{2})/gi)) {
        expect(offered, `${example.id} asks to choose ${label}`).toContain(label);
      }
      // The description names the measure it shows, in a year that can be chosen
      for (const [label] of example.description.matchAll(/\d{4}-\d{2}/g)) {
        expect(offered, `${example.id}: ${example.description}`).toContain(label);
      }
    }
  });
});

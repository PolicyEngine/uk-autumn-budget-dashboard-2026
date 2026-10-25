import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXAMPLE_GROUPS, HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest } from "./householdImpactApi";

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

  it("describe the household, never a measure", () => {
    // Review of #128's merge into #104: the published measures can change,
    // so an example naming one could name a measure the page doesn't show
    const registry = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "uk_budget_data", "reforms.py"), "utf8");
    const names = [...registry.matchAll(/^\s*name="([^"]+)"/gm)].map((match) => match[1].toLowerCase());
    expect(names.length).toBeGreaterThan(5);
    for (const example of HOUSEHOLD_EXAMPLES) {
      const text = `${example.label} ${example.description} ${example.note}`;
      for (const name of names) expect(text.toLowerCase(), example.id).not.toContain(name);
      // Nor by the short names #128's first wording and the r8 review used.
      // "Plan 2" stays allowed: it describes the loan a household holds.
      expect(text, example.id).not.toMatch(/freeze|unfrozen|top-up|Warm Home Discount|fuel duty|\bVAT\b|tax protection|employer NI|\bNI relief|asset disposal|\bBADR\b|threshold|see it/i);
    }
  });

  it("use neutral wording", () => {
    const text = HOUSEHOLD_EXAMPLES.map((example) => `${example.label} ${example.description} ${example.note}`).join(" ");
    expect(text).not.toMatch(/\b(poor|rich|wealthy)\b/i);
  });
});

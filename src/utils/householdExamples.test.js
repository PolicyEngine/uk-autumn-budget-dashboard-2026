import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { EXAMPLE_ICONS } from "../components/personal/HouseholdCards";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest } from "./householdImpactApi";
import { SELECTABLE_YEARS } from "./displayYears";
import { fiscalYearTick } from "./chartTheme";

const REGISTRY = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "uk_budget_data", "reforms.py"), "utf8");

describe("the example households", () => {
  it("are nine, with unique ids, a name, a one-line description, a measure and an icon each", () => {
    expect(HOUSEHOLD_EXAMPLES).toHaveLength(9);
    const ids = HOUSEHOLD_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of HOUSEHOLD_EXAMPLES) {
      expect(example.label.length).toBeGreaterThan(0);
      expect(example.description.length).toBeGreaterThan(0);
      expect(example.description.length).toBeLessThanOrEqual(60);
      expect(example.note.length).toBeGreaterThan(0);
      // The measure its card features: an id the registry defines (the card
      // shows it only while the catalogue publishes it), named short enough
      // for a tag
      for (const id of example.measures ?? [example.measure]) expect(REGISTRY, example.id).toContain(`"${id}"`);
      expect(example.measures ?? [example.measure], example.id).toContain(example.measure);
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

  it("never point to a year the year pill does not offer", () => {
    const offered = SELECTABLE_YEARS.map((year) => fiscalYearTick(year));
    for (const example of HOUSEHOLD_EXAMPLES) {
      const text = `${example.description} ${example.note}`;
      for (const [, label] of text.matchAll(/choose (\d{4}-\d{2})/gi)) {
        expect(offered, `${example.id} asks to choose ${label}`).toContain(label);
      }
      // Any year a description names is one that can be chosen (#104: it names no measure)
      for (const [label] of example.description.matchAll(/\d{4}-\d{2}/g)) {
        expect(offered, `${example.id}: ${example.description}`).toContain(label);
      }
    }
  });
});

import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDashboardCsv } from "./loadDashboard";
import {
  OBR_COMPARISON_BASES,
  OBR_DEVIATION_NOTES,
  OBR_DEVIATION_STATEMENT,
  comparisonBasisFor,
  deviationNoteFor,
  missingDeviationNotes,
} from "./obrDeviationNotes";
import { POLICY_DETAILS } from "./policyDetails";

// The measures the comparison costs: each one the Treasury mapping maps to
// the Budget's Table 6.1
const COMPARED = parseDashboardCsv(readFileSync("data_inputs/treasury/mapping.csv", "utf8"))
  .filter((row) => row.source_id === "AB2026-T6.1")
  .map((row) => row.measure_id);
// Every measure the registry defines (reforms.py), as the measure guard
// reads it (measureCatalogue.test.jsx), the combined package aside
const REGISTERED = [
  ...readFileSync("src/uk_budget_data/reforms.py", "utf8").matchAll(/^(?!AUTUMN_BUDGET_2026_COMBINED)[A-Z0-9_]+_ID = "([a-z0-9_]+)"$/gm),
].map((match) => match[1]);

describe("why our estimates differ from the official costings", () => {
  it("reads the Table 6.1 measures from the mapping, each once", () => {
    expect(COMPARED.length).toBeGreaterThan(0);
    expect(new Set(COMPARED).size).toBe(COMPARED.length);
  });

  it("explains every compared measure, and says what each side counts for it", () => {
    expect(missingDeviationNotes(COMPARED)).toEqual([]);
    expect(missingDeviationNotes(COMPARED, OBR_COMPARISON_BASES)).toEqual([]);
  });

  // A note may wait for a measure the registry defines but the comparison
  // does not yet cost (one left out of a release keeps its note); an id that
  // is no measure at all is a typo
  it("keeps notes only for measures the registry defines", () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    expect(COMPARED.filter((id) => !REGISTERED.includes(id))).toEqual([]);
    expect(Object.keys(OBR_DEVIATION_NOTES).filter((id) => !REGISTERED.includes(id))).toEqual([]);
    expect(Object.keys(OBR_COMPARISON_BASES).filter((id) => !REGISTERED.includes(id))).toEqual([]);
  });

  it("writes each note and the statement as whole sentences", () => {
    for (const text of [OBR_DEVIATION_STATEMENT, ...Object.values(OBR_DEVIATION_NOTES), ...Object.values(OBR_COMPARISON_BASES)]) {
      expect(text).toBe(text.trim());
      expect(text).toMatch(/^[A-Z].*\.$/s);
    }
  });

  it("says what each side counts as one line: the official side, then ours", () => {
    for (const [id, line] of Object.entries(OBR_COMPARISON_BASES)) {
      expect(line, id).toMatch(/^Official: [^]+\. Ours: [^]+\.$/);
      expect(line.match(/Official: /g), id).toHaveLength(1);
      expect(line.match(/Ours: /g), id).toHaveLength(1);
    }
  });

  // The corrections #297 made to the notes, from each measure's policy
  // costing note
  it("compares each note with the official costing on its own basis", () => {
    const note = (id) => OBR_DEVIATION_NOTES[id];
    // Pension Tax Allowance: the official costing is income tax only, so
    // the note opens with that, then gives our net cost
    expect(note("state_pension_income_tax_protection")).toMatch(/^The official costing counts income tax only\. Ours is £42m, £112m and £193m/);
    expect(note("state_pension_income_tax_protection")).toContain("our net cost is £30m, £83m and £144m");
    // Electricity: our base is DESNZ volumes at prices paid, not meter records
    expect(note("domestic_electricity_zero_vat")).not.toMatch(/meter records/);
    expect(note("domestic_electricity_zero_vat")).toMatch(/DESNZ's domestic electricity volumes[^]*ONS consumer spending, which is 10% to 12% lower/);
    // Fuel duty: the rest of the 2026-27 gap fits a full 5p back on 1 January
    expect(note("fuel_duty_rise_deferral")).not.toMatch(/no explanation/);
    expect(note("fuel_duty_rise_deferral")).toMatch(/full 5p returns on 1 January 2027[^]*3p and then 2p from 1 March/);
    // Savings: our interest included ISA interest; it is not missing
    expect(note("savings_income_rates_up")).toMatch(/ours included interest in ISAs, which HMRC's figures leave out/);
    expect(note("savings_income_rates_up")).toMatch(/We are correcting this[^]*will update the dashboard with the corrected data\.$/);
    expect(note("savings_income_rates_up")).not.toMatch(/miss(?:es)? ISA interest/);
  });

  it("names the four reasons in the statement", () => {
    for (const reason of ["when tax is counted", "coverage", "behaviour", "scope"]) {
      expect(OBR_DEVIATION_STATEMENT).toContain(reason);
    }
    // The official costings' basis as sourced (National Accounts), not
    // "when tax is paid"
    expect(OBR_DEVIATION_STATEMENT).toContain("National Accounts basis");
    expect(OBR_DEVIATION_STATEMENT).not.toMatch(/when (?:it|tax) is paid/);
  });

  it("finds a missing, empty or blank note, in the order given", () => {
    const notes = { a: "Timing.", b: "", c: "   ", e: 4 };
    expect(missingDeviationNotes(["a", "b", "c", "d", "e"], notes)).toEqual(["b", "c", "d", "e"]);
    expect(missingDeviationNotes([], notes)).toEqual([]);
  });

  it("shows every note and line for its measure as its card entry was written for", () => {
    for (const id of new Set([...COMPARED, ...Object.keys(OBR_DEVIATION_NOTES), ...Object.keys(OBR_COMPARISON_BASES)])) {
      const entry = POLICY_DETAILS.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(deviationNoteFor({ id, description: entry.writtenFor }), id).toBe(OBR_DEVIATION_NOTES[id]);
      expect(comparisonBasisFor({ id, description: entry.writtenFor }), id).toBe(OBR_COMPARISON_BASES[id]);
    }
  });

  it("shows a note for no other description, and none for a missing measure or note", () => {
    const written = Object.fromEntries(POLICY_DETAILS.map((entry) => [entry.id, entry.writtenFor]));
    fc.assert(
      fc.property(fc.constantFrom(...COMPARED), fc.string(), (id, description) => {
        fc.pre(description !== written[id]);
        expect(deviationNoteFor({ id, description })).toBeNull();
        expect(comparisonBasisFor({ id, description })).toBeNull();
      }),
    );
    for (const textFor of [deviationNoteFor, comparisonBasisFor]) {
      expect(textFor(undefined)).toBeNull();
      expect(textFor(null)).toBeNull();
      const [id] = COMPARED;
      expect(textFor({ id, description: written[id] }, {})).toBeNull();
      expect(textFor({ id, description: written[id] }, { [id]: "  " })).toBeNull();
      expect(textFor({ id, description: written[id] }, { [id]: " Timing. " })).toBe("Timing.");
    }
  });
});

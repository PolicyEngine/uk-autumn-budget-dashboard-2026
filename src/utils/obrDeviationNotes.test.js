import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDashboardCsv } from "./loadDashboard";
import {
  NOT_COMPARABLE_SHORT,
  OBR_COMPARISON_BASES,
  OBR_DEVIATION_NOTES,
  OBR_DEVIATION_STATEMENT,
  OBR_DIFFERENCE_POINTS,
  OBR_PANEL_BASES,
  REASON_TYPES,
  basisSides,
  pointsForYear,
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
  // costing note, kept in the short points (Vahid, 28 Oct)
  it("keeps the PR 297 corrections in the points", () => {
    const text = (id) => OBR_DIFFERENCE_POINTS[id].map((point) => point.text ?? Object.values(point.byYear).join(" ")).join(" ");
    // Pension Tax Allowance and Carer's Allowance as Max corrected them
    // against the OBR's policy Table 1.1 (PR 290, 6479807374)
    expect(OBR_COMPARISON_BASES.state_pension_income_tax_protection).toMatch(/^Official: income tax and small Scottish and departmental spending lines; no benefit savings/);
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).toMatch(/^The official costing counts no benefit savings: its income tax is £44m, £83m and £144m/);
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).not.toMatch(/because our data put more pensioners/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).toMatch(/£5 million and £10 million of extra block grant for Scotland/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).not.toMatch(/gap is close to the income tax/);
    expect(text("carers_allowance_earnings_taper")).not.toMatch(/explains most of the gap/);
    expect(text("state_pension_income_tax_protection")).toMatch(/670,000 vs 500,000/);
    expect(text("domestic_electricity_zero_vat")).not.toMatch(/meter records/);
    expect(text("domestic_electricity_zero_vat")).toMatch(/ONS spending base is 10–12% below ours \(DESNZ\)/);
    expect(text("fuel_duty_rise_deferral")).toMatch(/5p back on 1 Jan, law phases it/);
    expect(text("savings_income_rates_up")).toMatch(/included ISA interest/);
    expect(text("savings_income_rates_up")).not.toMatch(/miss(?:es)? ISA interest/);
  });

  it("writes every point and basis side as a short fragment, tagged with one of the four reasons, \"ours\" never PolicyEngine's (Vahid, 28 Oct)", () => {
    const words = (text) => text.split(/\s+/).length;
    for (const [id, points] of Object.entries(OBR_DIFFERENCE_POINTS)) {
      expect(points.length, id).toBeGreaterThan(0);
      expect(points.length, id).toBeLessThanOrEqual(3);
      for (const point of points) {
        if (point.reason !== null) expect(REASON_TYPES, id).toContain(point.reason);
        for (const text of point.text ? [point.text] : Object.values(point.byYear)) expect(words(text), text).toBeLessThanOrEqual(12);
      }
    }
    for (const [id, sides] of Object.entries(OBR_PANEL_BASES)) {
      expect(words(sides.official), id).toBeLessThanOrEqual(12);
      expect(words(sides.ours), id).toBeLessThanOrEqual(12);
    }
    for (const line of Object.values(OBR_COMPARISON_BASES)) expect(basisSides(line)).not.toBeNull();
    for (const text of [OBR_DEVIATION_STATEMENT, ...Object.values(OBR_DEVIATION_NOTES), ...Object.values(OBR_COMPARISON_BASES), ...Object.values(NOT_COMPARABLE_SHORT)]) {
      expect(text).not.toMatch(/PolicyEngine|£0\.0bn|\(rounded\)/);
    }
  });

  it("gives a point only in the years its figure holds", () => {
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.fuel_duty_rise_deferral, 2026).map((p) => p.text)).toEqual([
      "Households buy about £13bn of £24bn duty",
      "If we scaled to all fuel, ours would be about £450m",
      "Official assumes 5p back on 1 Jan, law phases it",
    ]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.fuel_duty_rise_deferral, 2027).map((p) => p.text)).toEqual(["If we scaled to all fuel, ours would be about £760m"]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.state_pension_income_tax_protection, 2028).map((p) => p.text)).toEqual(["Pension Credit, HB and CTR take back about a quarter"]);
  });

  it("names the four reasons in one sentence", () => {
    for (const reason of ["timing", "coverage", "behaviour", "scope"]) {
      expect(OBR_DEVIATION_STATEMENT).toContain(reason);
    }
    expect(OBR_DEVIATION_STATEMENT.match(/\./g)).toHaveLength(1);
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

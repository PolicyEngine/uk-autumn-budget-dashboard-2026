import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDashboardCsv } from "./loadDashboard";
import { OBR_DEVIATION_NOTES, OBR_DEVIATION_STATEMENT, deviationNoteFor, missingDeviationNotes } from "./obrDeviationNotes";
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

  it("explains every compared measure", () => {
    expect(missingDeviationNotes(COMPARED)).toEqual([]);
  });

  // A note may wait for a measure the registry defines but the comparison
  // does not yet cost (one left out of a release keeps its note); an id that
  // is no measure at all is a typo
  it("keeps notes only for measures the registry defines", () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    expect(COMPARED.filter((id) => !REGISTERED.includes(id))).toEqual([]);
    expect(Object.keys(OBR_DEVIATION_NOTES).filter((id) => !REGISTERED.includes(id))).toEqual([]);
  });

  it("writes each note and the statement as whole sentences", () => {
    for (const text of [OBR_DEVIATION_STATEMENT, ...Object.values(OBR_DEVIATION_NOTES)]) {
      expect(text).toBe(text.trim());
      expect(text).toMatch(/^[A-Z].*\.$/s);
    }
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

  it("shows every note for its measure as its card entry was written for", () => {
    for (const id of new Set([...COMPARED, ...Object.keys(OBR_DEVIATION_NOTES)])) {
      const entry = POLICY_DETAILS.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(deviationNoteFor({ id, description: entry.writtenFor }), id).toBe(OBR_DEVIATION_NOTES[id]);
    }
  });

  it("shows a note for no other description, and none for a missing measure or note", () => {
    const written = Object.fromEntries(POLICY_DETAILS.map((entry) => [entry.id, entry.writtenFor]));
    fc.assert(
      fc.property(fc.constantFrom(...COMPARED), fc.string(), (id, description) => {
        fc.pre(description !== written[id]);
        expect(deviationNoteFor({ id, description })).toBeNull();
      }),
    );
    expect(deviationNoteFor(undefined)).toBeNull();
    expect(deviationNoteFor(null)).toBeNull();
    const [id] = COMPARED;
    expect(deviationNoteFor({ id, description: written[id] }, {})).toBeNull();
    expect(deviationNoteFor({ id, description: written[id] }, { [id]: " Timing. " })).toBe("Timing.");
  });
});

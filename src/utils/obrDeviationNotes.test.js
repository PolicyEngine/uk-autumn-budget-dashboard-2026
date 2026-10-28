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

describe("why our estimates differ from the official costings", () => {
  it("compares the eight Table 6.1 measures", () => {
    expect(COMPARED).toHaveLength(8);
  });

  it("explains every compared measure", () => {
    expect(missingDeviationNotes(COMPARED)).toEqual([]);
  });

  it("explains no measure the comparison does not cost", () => {
    expect(Object.keys(OBR_DEVIATION_NOTES).filter((id) => !COMPARED.includes(id))).toEqual([]);
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
    for (const id of COMPARED) {
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDashboardCsv } from "./loadDashboard";
import { OBR_DEVIATION_NOTES, OBR_DEVIATION_STATEMENT, missingDeviationNotes } from "./obrDeviationNotes";

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
  });

  it("finds a missing, empty or blank note, in the order given", () => {
    const notes = { a: "Timing.", b: "", c: "   ", e: 4 };
    expect(missingDeviationNotes(["a", "b", "c", "d", "e"], notes)).toEqual(["b", "c", "d", "e"]);
    expect(missingDeviationNotes([], notes)).toEqual([]);
  });
});

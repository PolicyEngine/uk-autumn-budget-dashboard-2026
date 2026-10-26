import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLICY_PARAMETERS_SCHEMA,
  formatChange,
  formatValue,
  loadPolicyParameters,
  mergeRuns,
  parameterTableFor,
  resetPolicyParameters,
  sparkline,
  unitName,
  visibleRows,
} from "./policyParameters";

const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
const point = (year, before, after) => ({ key: String(year), label: `${year}`, year, before, after });

describe("policy_parameters.json, as the page reads it", () => {
  it("has the page's schema, a known unit and a timeline year for every value, and a source for each side", () => {
    expect(file.schema).toBe(POLICY_PARAMETERS_SCHEMA);
    for (const [id, table] of Object.entries(file.measures)) {
      expect(table.description, id).toBeTruthy();
      for (const row of table.rows) {
        expect(unitName(row.unit), `${id} ${row.label}`).toBeTruthy();
        expect(row.source.before.kind && row.source.after.kind).toBeTruthy();
        for (const p of row.points) {
          expect(p.year).toBeGreaterThanOrEqual(2026);
          expect(p.year).toBeLessThanOrEqual(2031);
        }
      }
      // Collapsed, every table shows something, in at most three lines
      const { rows } = visibleRows(table.rows);
      const lines = rows.reduce((n, row) => n + row.lines.length, 0);
      expect(lines, id).toBeGreaterThan(0);
      expect(lines, id).toBeLessThanOrEqual(3);
    }
  });
});

describe("formatting", () => {
  it("writes values in their units", () => {
    expect(formatValue(0.05, "percent")).toBe("5%");
    expect(formatValue(0.183425, "percent")).toBe("18.34%");
    expect(formatValue(52.95, "pence_per_litre")).toBe("52.95p");
    expect(formatValue(30060.87, "gbp")).toBe("£30,061");
    expect(formatValue(null, "gbp")).toBe("None");
  });

  it("signs a change", () => {
    expect(formatChange(0.2, 0.15, "percent")).toBe("−5pp");
    expect(formatChange(55.95, 52.95, "pence_per_litre")).toBe("−3p");
    expect(formatChange(29385, 30267, "gbp")).toBe("+£882");
    expect(formatChange(0.15, 0.15000000001, "percent")).toBe("No change");
    expect(formatChange(null, 50270, "gbp")).toBe("New");
  });
});

describe("the collapsed table", () => {
  it("merges consecutive years with the same change", () => {
    const lines = mergeRuns([point(2027, 1, 0), point(2028, 1, 0), point(2029, 2, 0), point(2031, 2, 0)]);
    expect(lines.map(({ label, from, to }) => [label, from, to])).toEqual([
      ["2027 to 2028", 2027, 2028], ["2029", 2029, 2029], ["2031", 2031, 2031],
    ]);
  });

  it("keeps each primary row's first change within three lines", () => {
    const row = (label, points, primary = true) => ({ label, unit: "gbp", primary, points });
    const rows = [
      row("A", [point(2026, 1, 2), point(2027, 1, 3), point(2028, 1, 4), point(2029, 1, 5)]),
      row("B", [point(2031, 1, 2)]),
      row("C", [point(2031, 1, 2)], false),
    ];
    const { rows: shown, more } = visibleRows(rows);
    expect(shown.map((r) => [r.label, r.lines.length])).toEqual([["A", 2], ["B", 1]]);
    expect(more).toBe(true);
    expect(visibleRows(rows, { expanded: true }).rows.map((r) => r.lines.length)).toEqual([4, 1, 1]);
  });
});

describe("parameterTableFor", () => {
  const tables = { measures: { a: { description: "As built.", rows: [{ label: "x" }] } } };
  it("gives a measure's rows only for the description they were built from", () => {
    expect(parameterTableFor(tables, { id: "a", description: "As built." })).toEqual([{ label: "x" }]);
    expect(parameterTableFor(tables, { id: "a", description: "Changed." })).toBeNull();
    expect(parameterTableFor(tables, { id: "b", description: "As built." })).toBeNull();
    expect(parameterTableFor(null, { id: "a", description: "As built." })).toBeNull();
  });
});

describe("sparkline", () => {
  it("draws both sides across the years, and nothing for fewer than three points", () => {
    const spark = sparkline([point(2026, 1, 1), point(2027, 1, 2), point(2028, 1, 3)]);
    expect(spark.before.split(" ")).toHaveLength(3);
    expect(spark.after.split(" ")).toHaveLength(3);
    expect(sparkline([point(2026, 1, 2)])).toBeNull();
  });
});

describe("loadPolicyParameters", () => {
  it("reads the file under the base path once, and gives null for another schema or a failure", async () => {
    resetPolicyParameters();
    const urls = [];
    const ok = (body) => async (url) => (urls.push(url), { ok: true, json: async () => body });
    expect(await loadPolicyParameters({ fetchImpl: ok(file), base: "/uk/autumn-budget-2026" })).toBe(file);
    expect(await loadPolicyParameters({ fetchImpl: ok(null) })).toBe(file);
    expect(urls).toEqual(["/uk/autumn-budget-2026/data/policy_parameters.json"]);
    resetPolicyParameters();
    expect(await loadPolicyParameters({ fetchImpl: ok({ schema: "other" }) })).toBeNull();
    resetPolicyParameters();
    expect(await loadPolicyParameters({ fetchImpl: async () => { throw new Error("offline"); } })).toBeNull();
    resetPolicyParameters();
  });
});

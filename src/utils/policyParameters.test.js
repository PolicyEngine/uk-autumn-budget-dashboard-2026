import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLICY_PARAMETERS_SCHEMA,
  describeSegment,
  formatChange,
  formatValue,
  loadPolicyParameters,
  monthOf,
  parameterTableFor,
  resetPolicyParameters,
  segmentsFor,
  switchChange,
} from "./policyParameters";

const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
const rowsOf = (id) => Object.fromEntries(file.measures[id].rows.map((row) => [row.label, row]));

describe("policy_parameters.json, as the page reads it", () => {
  it("has the page's schema, and a display the page draws for every measure", () => {
    expect(file.schema).toBe(POLICY_PARAMETERS_SCHEMA);
    for (const [id, table] of Object.entries(file.measures)) {
      expect(parameterTableFor(file, { id, description: table.description }), id).toBeTruthy();
      for (const row of table.rows) expect(row.unit_words, `${id} ${row.label}`).not.toBe("pounds");
    }
    expect(switchChange(file.measures.road_fuel_vat_cut)).toBe("20% → 15%");
    expect(switchChange(file.measures.warm_home_discount_top_up)).toBe("£150 → £250");
    expect(switchChange(file.measures.badr_lifetime_limit_cut)).toBeNull();
  });

  it("draws fuel duty on a time axis, stepping on each date", () => {
    const segments = segmentsFor(rowsOf("fuel_duty_rise_deferral")["Fuel duty"]);
    expect(segments[0]).toMatchObject({ start: 0, before: 52.95, after: 52.95 });
    const january = segments.find((s) => s.label === "From 1 January 2027");
    expect(january.start).toBeCloseTo(9);
    expect(january.end).toBeCloseTo(11);
    expect(january).toMatchObject({ from: 2026, to: 2026 });
    expect(segments[segments.length - 1].end).toBe(72);
  });

  it("draws a VAT window as current law either side of it", () => {
    const segments = segmentsFor(rowsOf("road_fuel_vat_cut")["VAT on petrol and diesel"]);
    expect(segments.map((s) => [s.start, s.end, s.after])).toEqual([[0, 8, 0.2], [8, 14, 0.15], [14, 72, 0.2]]);
    expect(segments[1]).toMatchObject({ from: 2026, to: 2027 });
  });

});

describe("words", () => {
  it("writes values in their units", () => {
    expect(formatValue(0.05, "percent")).toBe("5%");
    expect(formatValue(52.95, "pence_per_litre")).toBe("52.95p");
    expect(formatValue(30060.87, "gbp")).toBe("£30,061");
  });

  it("signs an amount's change, and gives a rate's as the two rates", () => {
    expect(formatChange(0.15, 0, "percent")).toBe("15% → 0%");
    expect(formatChange(55.95, 52.95, "pence_per_litre")).toBe("−3p");
    expect(formatChange(12570, 13700, "gbp")).toBe("+£1,130");
    expect(formatChange(0.15, 0.15000000001, "percent")).toBe("no change");
  });

  it("says a step for the tooltip", () => {
    expect(describeSegment({ label: "2029-30", before: 12570, after: 13700 }, "gbp")).toBe("2029-30: £12,570 → £13,700 (+£1,130)");
    expect(describeSegment({ label: "2026-27", before: 12570, after: 12570 }, "gbp")).toBe("2026-27: £12,570, as under current law");
  });

  it("puts a date on the timeline's months", () => {
    expect(monthOf("2026-04-01")).toBe(0);
    expect(monthOf("2027-01-01")).toBe(9);
  });
});

describe("parameterTableFor", () => {
  const tables = { measures: { a: { description: "As built.", display: "path", rows: [{ label: "x" }] } } };
  it("gives a measure's entry only for the description it was built from, and a known display", () => {
    expect(parameterTableFor(tables, { id: "a", description: "As built." })).toEqual({ display: "path", rows: [{ label: "x" }] });
    expect(parameterTableFor({ measures: { a: { ...tables.measures.a, display: "other" } } }, { id: "a", description: "As built." })).toBeNull();
    expect(parameterTableFor(tables, { id: "a", description: "Changed." })).toBeNull();
    expect(parameterTableFor(tables, { id: "b", description: "As built." })).toBeNull();
    expect(parameterTableFor(null, { id: "a", description: "As built." })).toBeNull();
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

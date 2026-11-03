import { describe, expect, it, vi } from "vitest";
import {
  loadOfficialCostings,
  OfficialCostingsPendingError,
  officialCostingRows,
  OFFICIAL_COSTINGS_SCHEMA,
} from "./officialCostings";

const BUDGET = { id: "uk-autumn-budget-2026", date: "2026-10-28" };
const manifest = { release: "uk-autumn-budget-2026", budget: BUDGET, measures: { rate: {}, other: {} }, combined: { "combined--abc": {} } };
const doc = (overrides = {}) => ({
  schema: OFFICIAL_COSTINGS_SCHEMA,
  release: "uk-autumn-budget-2026",
  budget: BUDGET,
  sign_convention: "exchequer_positive",
  measures: { rate: { years: { 2027: { static_costing: -1.2, post_behavioural: -1.0 }, 2028: { static_costing: 0.5, post_behavioural: null } } } },
  ...overrides,
});

describe("officialCostingRows", () => {
  it("returns both bases by measure and year", () => {
    expect(officialCostingRows(doc(), manifest)).toEqual([
      { reform_id: "rate", year: 2027, obr_static: -1.2, obr_behavioural: -1.0 },
      { reform_id: "rate", year: 2028, obr_static: 0.5, obr_behavioural: null },
    ]);
  });

  it("refuses costings for another Budget, as last year's obr_estimates were", () => {
    expect(() => officialCostingRows(doc({ budget: { id: "uk-autumn-budget-2025", date: "2025-11-26" } }), manifest)).toThrow(/not for this Budget/);
    expect(() => officialCostingRows(doc({ release: "uk-autumn-budget-2025" }), manifest)).toThrow(/not for this Budget/);
  });

  it("refuses a manifest that is not this Budget's", () => {
    expect(() => officialCostingRows(doc(), { ...manifest, budget: { id: "uk-autumn-budget-2025", date: "2025-11-26" } })).toThrow();
  });

  it("refuses a measure the manifest does not list, a combined run included", () => {
    expect(() => officialCostingRows(doc({ measures: { gone: { years: {} } } }), manifest)).toThrow(/not a published measure/);
    expect(() => officialCostingRows(doc({ measures: { "combined--abc": { years: {} } } }), manifest)).toThrow(/not a published measure/);
  });

  it("refuses a wrong schema, sign convention or a figure that is not a number", () => {
    expect(() => officialCostingRows(doc({ schema: "x" }), manifest)).toThrow(/schema/);
    expect(() => officialCostingRows(doc({ sign_convention: "cost_positive" }), manifest)).toThrow(/malformed/);
    expect(() => officialCostingRows(doc({ measures: { rate: { years: { 2027: { static_costing: "1.2" } } } } }), manifest)).toThrow(/not a number/);
    expect(() => officialCostingRows(doc({ measures: { rate: { years: { "27": { static_costing: 1 } } } } }), manifest)).toThrow(/malformed/);
  });

  it("carries the reason for a year a reviewer classified not comparable", () => {
    const reason = "Allowance ends 5 April 2030";
    const years = { 2029: { static_costing: null, post_behavioural: -0.15 }, 2030: { static_costing: null, post_behavioural: null, not_comparable: { reason } } };
    expect(officialCostingRows(doc({ measures: { rate: { years } } }), manifest)).toEqual([
      { reform_id: "rate", year: 2029, obr_static: null, obr_behavioural: -0.15 },
      { reform_id: "rate", year: 2030, obr_static: null, obr_behavioural: null, not_comparable: reason },
    ]);
  });

  it("refuses a not-comparable year with no reason or with a figure", () => {
    const with_ = (figures) => doc({ measures: { rate: { years: { 2030: figures } } } });
    expect(() => officialCostingRows(with_({ static_costing: null, post_behavioural: null, not_comparable: {} }), manifest)).toThrow(/malformed/);
    expect(() => officialCostingRows(with_({ static_costing: null, post_behavioural: null, not_comparable: "x" }), manifest)).toThrow(/malformed/);
    expect(() => officialCostingRows(with_({ static_costing: null, post_behavioural: 0.05, not_comparable: { reason: "x" } }), manifest)).toThrow(/malformed/);
  });
});

describe("loadOfficialCostings", () => {
  const catalogue = { manifest };

  it("reads the file beside the manifest", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(doc())));
    const rows = await loadOfficialCostings(catalogue, { basePath: "/base", fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("/base/data/official_costings.json");
    expect(rows).toHaveLength(2);
  });

  it("is pending while the file is not published", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    await expect(loadOfficialCostings(catalogue, { fetchImpl })).rejects.toBeInstanceOf(OfficialCostingsPendingError);
  });

  it("fails without a manifest or on another error", async () => {
    await expect(loadOfficialCostings({}, { fetchImpl: vi.fn() })).rejects.toThrow(/published no Budget results/);
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    await expect(loadOfficialCostings(catalogue, { fetchImpl })).rejects.not.toBeInstanceOf(OfficialCostingsPendingError);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMeasureCatalogue, COST_COLORS, REVENUE_COLORS, measureColor, NEUTRAL_COLOR, isCatalogueRowDisplayable } from "./measureCatalogue";
import { budgetChartData, loadDashboard, parseDashboardCsv } from "./loadDashboard";
import { fixtureJson } from "../test/publicationFixture";
import { ALPHA, BETA, COMBINED, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

function validManifest() {
  const base = fixtureJson("manifest.json");
  const { manifest } = measureCatalogueFixture();
  const entry = base.measures.alpha;
  return {
    ...base,
    measures: Object.fromEntries(Object.entries(manifest.measures).map(([id, metadata]) => [id, { ...entry, ...metadata }])),
    combined: {},
  };
}

describe("published measure catalogue", () => {
  it("prefers publication metadata, excludes combined runs and retains held notices", () => {
    const fixture = measureCatalogueFixture();
    fixture.budgetary[0].reform_name = "Old CSV label";
    const catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.measures).toHaveLength(3);
    expect(catalogue.byId.get(ALPHA)).toMatchObject({ name: "Mock alpha support", description: "Published support for mock households.", direction: "cost" });
    expect(catalogue.displayable.map((measure) => measure.id).sort()).toEqual([ALPHA, BETA]);
    expect(catalogue.byId.get(HELD).availability.reason).toMatch(/Not computable/);
    expect(catalogue.byId.has(COMBINED)).toBe(false);
    expect(catalogue.combinedId).toBeNull();
  });

  it("falls back to CSV labels/descriptions, with receipt metadata preferred", () => {
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = buildMeasureCatalogue({ ...fixture, manifest: null, receipts: { [ALPHA]: { dashboard: { name: "Receipt label", description: "Receipt public description" } } } });
    expect(catalogue.byId.get(ALPHA).description).toBe("Receipt public description");
    expect(catalogue.byId.get(BETA).name).toBe("Mock beta contribution");
    expect(catalogue.combinedId).toBe(COMBINED);
  });

  it("keeps equal labels and reserved chart keys distinct", () => {
    const budgetary = [
      { reform_id: "a", reform_name: "Shared label", value: -2 },
      { reform_id: "b", reform_name: "Shared label", value: 3 },
      { reform_id: "c", reform_name: "year", value: 1 },
    ];
    const catalogue = buildMeasureCatalogue({ budgetary });
    expect(catalogue.byName.size).toBe(3);
    const [point] = budgetChartData(budgetary.map((row) => ({ ...row, year: 2029 })), catalogue.displayable, ["a", "b", "c"], [2029]);
    expect(point.year).toBe(2029);
    expect(point.netImpact).toBe(2);
    expect(catalogue.displayable.map((measure) => point[measure.name]).sort()).toEqual([-2, 1, 3]);
  });

  it("rejects outdated combined membership fingerprints and unsupported fiscal years", () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].unsupported_years = [2030];
    fixture.budgetary.push({ reform_id: ALPHA, reform_name: "Mock alpha support", year: 2030, value: 999 });
    let catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.byId.get(ALPHA).direction).toBe("cost");
    expect(isCatalogueRowDisplayable(catalogue, ALPHA, 2030)).toBe(false);
    expect(isCatalogueRowDisplayable(catalogue, COMBINED, 2030)).toBe(false);
    fixture.manifest.combined[COMBINED].member_outputs_sha256[ALPHA] = "b".repeat(64);
    catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.combinedId).toBeNull();
    expect(isCatalogueRowDisplayable(catalogue, COMBINED, 2029)).toBe(false);
  });

  it.each(["staged", "stale", "withdrawn", "not_computable"])("holds %s measures without a figure", (status) => {
    const fixture = measureCatalogueFixture();
    fixture.manifest.measures[HELD].status = status;
    const catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.displayable.some((measure) => measure.id === HELD)).toBe(false);
    expect(isCatalogueRowDisplayable(catalogue, HELD, 2029)).toBe(false);
    expect(catalogue.byId.get(HELD).availability.available).toBe(false);
  });

  it("never fabricates a zero or partial net figure for a missing costing", () => {
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = buildMeasureCatalogue(fixture);
    const points = budgetChartData(fixture.budgetary.filter((row) => row.reform_id !== BETA), catalogue.displayable, [ALPHA, BETA], [2029]);
    expect(points[0]).toMatchObject({ netImpact: null, unpublished: true, "Mock beta contribution": null });
  });

  it("parses published descriptions with quotes, commas and embedded newlines", () => {
    expect(parseDashboardCsv('reform_id,reform_name,reform_description\r\na,"Public, label","A ""quoted""\nexplanation"\r\n')).toEqual([{ reform_id: "a", reform_name: "Public, label", reform_description: 'A "quoted"\nexplanation' }]);
  });

  it("gates stale flat rows with a present manifest and rejects manifest errors", async () => {
    const manifest = validManifest();
    const csv = `reform_id,reform_name,year,value\n${ALPHA},CSV label,2029,-2\n${HELD},Held,2029,999\nunpublished,Unpublished,2029,999\n`;
    const serve = async (url) => url.endsWith("manifest.json") ? new Response(JSON.stringify(manifest)) : new Response(csv);
    const loaded = await loadDashboard("", { fetchImpl: serve });
    expect(loaded.budgetary.map((row) => row.reform_id)).toEqual([ALPHA]);
    expect(loaded.catalogue.byId.get(HELD).displayable).toBe(false);
    await expect(loadDashboard("", { fetchImpl: async (url) => url.endsWith("manifest.json") ? new Response("", { status: 500 }) : new Response(csv) })).rejects.toThrow("HTTP 500");
    await expect(loadDashboard("", { fetchImpl: async (url) => new Response(url.endsWith("manifest.json") ? "{}" : csv) })).rejects.toThrow("invalid");
  });

  it("uses the reviewed flat route only when the manifest is absent", async () => {
    const csv = `reform_id,reform_name,reform_description,year,value\n${ALPHA},CSV alpha,Published CSV explanation,2029,-2\n`;
    const loaded = await loadDashboard("", { fetchImpl: async (url) => url.endsWith("manifest.json") ? new Response(null, { status: 404 }) : new Response(csv) });
    expect(loaded.catalogue.byId.get(ALPHA)).toMatchObject({ name: "CSV alpha", description: "Published CSV explanation", displayable: true });
  });

  it("colours are pure functions of id and sign, from disjoint palettes", () => {
    expect(COST_COLORS.some((color) => REVENUE_COLORS.includes(color))).toBe(false);
    fc.assert(fc.property(fc.string(), (id) => {
      expect(COST_COLORS).toContain(measureColor(id, "cost"));
      expect(REVENUE_COLORS).toContain(measureColor(id, "revenue"));
      expect(measureColor(id, "cost")).toBe(measureColor(id, "cost"));
      expect(measureColor(id, "neutral")).toBe(NEUTRAL_COLOR);
    }), { numRuns: 200 });
  });

  it("catalogue membership, order and colours survive permutation and extension", () => {
    const records = fc.uniqueArray(fc.record({ id: fc.stringMatching(/^[a-z][a-z0-9]{0,20}$/), value: fc.integer({ min: -10000, max: 10000 }) }), { selector: (record) => record.id, maxLength: 30 });
    fc.assert(fc.property(records, (records) => {
      const budgetary = records.map(({ id, value }) => ({ reform_id: id, reform_name: `Published ${id}`, value, year: 2029 }));
      const first = buildMeasureCatalogue({ budgetary });
      const reversed = buildMeasureCatalogue({ budgetary: [...budgetary].reverse() });
      expect(first.measures).toEqual(reversed.measures);
      expect(new Set(first.measures.map((measure) => measure.id))).toEqual(new Set(records.map((record) => record.id)));
      const extended = buildMeasureCatalogue({ budgetary: [...budgetary, { reform_id: "extension_measure", reform_name: "Additional measure", value: -1 }] });
      for (const measure of first.measures) expect(extended.byId.get(measure.id).color).toBe(measure.color);
    }), { numRuns: 150 });
  });
});

it("frontend source contains no embedded Budget measure names or ids", () => {
  // Python model definitions are intentionally outside this frontend guard:
  // removing them would change reform logic, which this change must preserve.
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const forbidden = /two[ _-]child[ _-]limit|2 child limit repeal|fuel[ _-]duty[ _-]freeze|rail[ _-]fares?[ _-]freeze|threshold[ _-]freeze|dividend_tax_increase_2pp|savings_tax_increase_2pp|property_tax_increase_2pp|(?:dividend|savings(?: income)?|property(?: income)?) tax increase|salary[ _-]sacrifice[ _-]cap|freeze_student_loan_thresholds|freeze student loan repayment thresholds|sl_threshold_freeze|unearned_income_tax/i;
  const matches = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["test", "__pycache__", "uk_budget_data"].includes(entry.name) && !entry.name.endsWith(".egg-info")) walk(path);
      } else if (!/\.(test|spec)\./.test(entry.name) && forbidden.test(readFileSync(path, "utf8"))) matches.push(relative(root, path));
    }
  }
  walk(root);
  expect(matches).toEqual([]);
});

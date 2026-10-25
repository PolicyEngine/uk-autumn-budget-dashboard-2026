import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMeasureCatalogue, COST_COLORS, REVENUE_COLORS, measureColor, NEUTRAL_COLOR, isCatalogueRowDisplayable, publishedDefinitions } from "./measureCatalogue";
import { FULL_COMMIT } from "./publication/definitions";
import { approvedDefinition } from "../test/definitionsFixture";
import { budgetChartData, parseDashboardCsv } from "./loadDashboard";
import { ALPHA, BETA, COMBINED, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

function fromRows(budgetary) {
  const fixture = measureCatalogueFixture({ held: false });
  fixture.manifest.measures = Object.fromEntries(budgetary.map((row) => [row.reform_id, {
    name: row.reform_name, status: "approved", years: [2029], unsupported_years: [],
  }]));
  fixture.manifest.combined = {};
  const tablesByKey = Object.fromEntries(budgetary.map((row) => [row.reform_id, { budgetary_impact: [row] }]));
  return buildMeasureCatalogue({ ...fixture, budgetary, tablesByKey });
}

describe("published measure catalogue", () => {
  it("prefers publication metadata, excludes combined runs and retains held notices", () => {
    const fixture = measureCatalogueFixture();
    fixture.budgetary[0].reform_name = "Old CSV label";
    const catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.measures).toHaveLength(3);
    expect(catalogue.byId.get(ALPHA)).toMatchObject({ name: "Mock alpha support", direction: "cost", years: fixture.manifest.measures[ALPHA].years, unsupported_years: [] });
    expect(catalogue.displayable.map((measure) => measure.id).sort()).toEqual([ALPHA, BETA]);
    expect(catalogue.byId.get(HELD).availability.reason).toMatch(/Not computable/);
    expect(catalogue.byId.has(COMBINED)).toBe(false);
    expect(catalogue.combinedId).toBeNull();
  });

  it("does not offer an approved measure until its artifact has verified", () => {
    const fixture = measureCatalogueFixture({ held: false });
    delete fixture.tablesByKey[ALPHA];
    const catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.displayable.map((measure) => measure.id)).toEqual([BETA]);
    expect(catalogue.byId.get(ALPHA).availability).toMatchObject({ available: false, reason: "Results unavailable: no verified artifact" });
    expect(catalogue.combinedId).toBeNull();
    expect(isCatalogueRowDisplayable(catalogue, ALPHA, 2029)).toBe(false);
  });

  it("does not offer an artifact that failed verification even if a table key remains", () => {
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = buildMeasureCatalogue({ ...fixture, failures: { [ALPHA]: "receipt digest differs" } });
    expect(catalogue.displayable.map((measure) => measure.id)).toEqual([BETA]);
    expect(catalogue.byId.get(ALPHA).availability.reason).toContain("receipt digest differs");
  });

  it("takes the package from the combined run of exactly the displayable measures", () => {
    // A held measure is listed as unavailable, never part of the package: the
    // combined run that leaves it out is the one the page shows
    const fixture = measureCatalogueFixture();
    fixture.manifest.combined[COMBINED].measures = [ALPHA, BETA];
    fixture.manifest.combined[COMBINED].member_outputs_sha256 = { [ALPHA]: "a".repeat(64), [BETA]: "a".repeat(64) };
    expect(buildMeasureCatalogue(fixture).combinedId).toBe(COMBINED);
    expect(isCatalogueRowDisplayable(buildMeasureCatalogue(fixture), COMBINED, 2029)).toBe(true);
    // A run that includes the held measure describes no selection the page offers
    fixture.manifest.combined[COMBINED].measures = [ALPHA, BETA, HELD];
    expect(buildMeasureCatalogue(fixture).combinedId).toBeNull();
  });

  it("requires a manifest even when historical CSVs or receipts exist", () => {
    const fixture = measureCatalogueFixture();
    const catalogue = buildMeasureCatalogue({ ...fixture, manifest: null });
    expect(catalogue.measures).toEqual([]);
    expect(catalogue.combinedId).toBeNull();
    expect(isCatalogueRowDisplayable(catalogue, ALPHA, 2029)).toBe(false);
  });

  it.each(["unpublished", "incomplete", "year", "netImpact"])("namespaces the published label %s", (label) => {
    const rows = [{ reform_id: "a", reform_name: label, year: 2029, value: 2 }];
    const catalogue = fromRows(rows);
    const [point] = budgetChartData(rows, catalogue.displayable, ["a"], [2029]);
    expect(point).toMatchObject({ year: 2029, netImpact: 2, unpublished: false, "measure:a": 2 });
    expect(catalogue.byId.get("a").label).toBe(label);
  });

  it("keeps unsupported fiscal years out of standalone and combined results", () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].unsupported_years = [2030];
    const catalogue = buildMeasureCatalogue(fixture);
    expect(isCatalogueRowDisplayable(catalogue, ALPHA, 2030)).toBe(false);
    expect(isCatalogueRowDisplayable(catalogue, COMBINED, 2030)).toBe(false);
    fixture.manifest.combined[COMBINED].member_outputs_sha256[ALPHA] = "b".repeat(64);
    expect(buildMeasureCatalogue(fixture).combinedId).toBeNull();
  });

  it.each(["staged", "stale", "withdrawn", "not_computable"])("holds %s measures without a figure", (status) => {
    const fixture = measureCatalogueFixture();
    fixture.manifest.measures[HELD].status = status;
    const catalogue = buildMeasureCatalogue(fixture);
    expect(catalogue.displayable.some((measure) => measure.id === HELD)).toBe(false);
    expect(isCatalogueRowDisplayable(catalogue, HELD, 2029)).toBe(false);
  });

  it("suppresses a net figure for a missing costing", () => {
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = buildMeasureCatalogue(fixture);
    const [point] = budgetChartData(fixture.budgetary.filter((row) => row.reform_id !== BETA), catalogue.displayable, [ALPHA, BETA], [2029]);
    expect(point).toMatchObject({ netImpact: null, unpublished: true, [`measure:${BETA}`]: null });
  });

  it("parses quoted CSV metadata cells", () => {
    expect(parseDashboardCsv('id,name\r\na,"Public, label"\r\n')).toEqual([{ id: "a", name: "Public, label" }]);
  });

  it("colours are stable functions of id and sign", () => {
    expect(COST_COLORS.some((color) => REVENUE_COLORS.includes(color))).toBe(false);
    fc.assert(fc.property(fc.string(), (id) => {
      expect(COST_COLORS).toContain(measureColor(id, "cost"));
      expect(REVENUE_COLORS).toContain(measureColor(id, "revenue"));
      expect(measureColor(id, "neutral")).toBe(NEUTRAL_COLOR);
    }), { numRuns: 100 });
  });

  it("series keys never collide with metadata or labels, including arbitrary ids", () => {
    fc.assert(fc.property(fc.uniqueArray(fc.record({ id: fc.string({ minLength: 1 }), label: fc.string(), value: fc.integer({ min: -1000, max: 1000 }) }), { selector: (row) => row.id, maxLength: 15 }), (records) => {
      const rows = records.map(({ id, label, value }) => ({ reform_id: id, reform_name: label || id, year: 2029, value }));
      const catalogue = fromRows(rows);
      const selected = catalogue.displayable.map((measure) => measure.id);
      const [point] = budgetChartData(rows, catalogue.displayable, selected, [2029]);
      expect(point.year).toBe(2029);
      expect(point.netImpact).toBe(records.filter((record) => selected.includes(record.id)).reduce((sum, row) => sum + row.value, 0));
      for (const measure of catalogue.displayable) expect(point[measure.seriesKey]).toBe(records.find((row) => row.id === measure.id).value);
      expect(new Set(catalogue.measures.map((measure) => measure.seriesKey)).size).toBe(catalogue.measures.length);
      expect(buildMeasureCatalogue({ manifest: catalogue.manifest, budgetary: [...rows].reverse(), tablesByKey: catalogue.tablesByKey }).measures).toEqual(catalogue.measures);
    }), { numRuns: 100 });
  });
});

describe("the row gate (the page's core invariant)", () => {
  const STATUSES = ["approved", "provisional", "staged", "stale", "withdrawn", "not_computable"];
  it("shows a row only for a verified key, a displayable status and a supported year", () => {
    fc.assert(fc.property(
      fc.boolean(), fc.boolean(), fc.constantFrom(...STATUSES), fc.constantFrom(...STATUSES),
      fc.constantFrom(2028, 2029, 2030), fc.boolean(), fc.constantFrom(ALPHA, COMBINED, "unlisted"),
      (hasManifest, verified, alphaStatus, packageStatus, year, alphaLimited, id) => {
        const fixture = measureCatalogueFixture({ held: false });
        fixture.manifest.measures[ALPHA].status = alphaStatus;
        fixture.manifest.combined[COMBINED].status = packageStatus;
        for (const entry of [...Object.values(fixture.manifest.measures), ...Object.values(fixture.manifest.combined)]) entry.years = [2029, 2030];
        if (alphaLimited) fixture.manifest.measures[ALPHA].unsupported_years = [2030];
        if (!verified) delete fixture.tablesByKey[id];
        const catalogue = buildMeasureCatalogue({ ...fixture, manifest: hasManifest ? fixture.manifest : null });
        const shown = isCatalogueRowDisplayable(catalogue, id, year);
        const displayable = (status) => ["approved", "provisional"].includes(status);
        const supported = (limited) => [2029, 2030].includes(year) && !(limited && year === 2030);
        const alphaShown = displayable(alphaStatus) && supported(alphaLimited);
        const expected = hasManifest && verified && (
          id === ALPHA ? alphaShown
            // The package needs every member displayable (it is the run of
            // exactly the displayable measures) and supported in the year
            : id === COMBINED ? displayable(packageStatus) && displayable(alphaStatus) && supported(alphaLimited) && supported(false)
              : false
        );
        expect(shown).toBe(expected);
      },
    ), { numRuns: 300 });
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

describe("publishedDefinitions", () => {
  const commit = fc.oneof(fc.constant("c".repeat(40)), fc.constant("d".repeat(64)), fc.constant("C".repeat(40)), fc.constant("abc1234"), fc.constant(null), fc.constant(7));
  const tables = fc.option(fc.record({ definition: fc.option(commit.map((git_sha) => ({ ...approvedDefinition(), git_sha })), { nil: undefined }) }), { nil: undefined });

  it("puts each selected measure in exactly one of definitions or missing, failing closed", () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.constantFrom("alpha", "beta", "gamma", "constructor", "__proto__", "hasOwnProperty"), { maxLength: 5 }),
      fc.func(tables),
      (ids, tablesFor) => {
        const tablesByKey = Object.create(null);
        for (const id of ids) {
          const value = tablesFor(id);
          if (value !== undefined) tablesByKey[id] = value;
        }
        const { definitions, missing } = publishedDefinitions({ tablesByKey }, ids);
        const missingIds = missing.map((item) => item.id);
        expect([...Object.keys(definitions), ...missingIds].sort()).toEqual([...ids].sort());
        for (const id of Object.keys(definitions)) {
          expect(definitions[id]).toBe(tablesByKey[id].definition);
          expect(FULL_COMMIT.test(definitions[id].git_sha)).toBe(true);
        }
        for (const item of missing) expect(item.reason).toMatch(/no definition|no full commit/);
      },
    ));
  });

  it("finds nothing on the prototype, and nothing without verified tables", () => {
    expect(publishedDefinitions({ tablesByKey: {} }, ["constructor", "toString"]).missing.map((item) => item.id)).toEqual(["constructor", "toString"]);
    expect(publishedDefinitions({}, ["alpha"]).missing).toHaveLength(1);
    expect(publishedDefinitions(null, ["alpha"]).missing).toHaveLength(1);
  });
});

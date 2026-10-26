// Synthetic published rows: these identifiers have no frontend-specific handling.
export const ALPHA = "ab2026_mock_alpha";
export const BETA = "ab2026_mock_beta";
export const HELD = "ab2026_mock_held";
export const COMBINED = "ab2026_mock_combined";
export const YEAR = 2029;

const definitions = [
  { id: ALPHA, name: "Mock alpha support", description: "Published support for mock households.", value: -2 },
  { id: BETA, name: "Mock beta contribution", description: "Published contribution from mock households.", value: 3 },
  { id: HELD, name: "Mock held measure", description: "A measure the current data cannot model.", value: 999 },
];

export function measureCatalogueFixture({ held = true } = {}) {
  const measures = held ? definitions : definitions.slice(0, 2);
  const manifest = {
    release: "uk-autumn-budget-2026",
    budget: { id: "uk-autumn-budget-2026", date: "2026-10-28" },
    measures: Object.fromEntries(measures.map((measure) => [measure.id, {
      name: measure.name,
      description: measure.description,
      status: measure.id === HELD ? "not_computable" : "approved",
      years: [2026, 2027, 2028, 2029, 2030, 2031],
      unsupported_years: [],
      outputs_sha256: "a".repeat(64),
      ...(measure.id === HELD ? { data_limits: ["synthetic_limit"], reason: "Synthetic data limit" } : {}),
    }])),
    combined: {
      [COMBINED]: { name: "Mock combined package", status: "approved", measures: measures.map((measure) => measure.id), member_outputs_sha256: Object.fromEntries(measures.map((measure) => [measure.id, "a".repeat(64)])), years: [2026, 2027, 2028, 2029, 2030, 2031], unsupported_years: [] },
    },
  };
  const budgetary = [...measures, { id: COMBINED, name: "Mock combined package", value: 1 }].map((measure) => ({
    reform_id: measure.id, reform_name: measure.name, reform_description: measure.description,
    year: YEAR, value: measure.value,
  }));
  const distributional = measures.flatMap((measure, index) => Array.from({ length: 10 }, (_, decile) => ({
    reform_id: measure.id, reform_name: measure.name, year: YEAR,
    decile: `${decile + 1}${decile === 0 ? "st" : decile === 1 ? "nd" : decile === 2 ? "rd" : "th"}`,
    value: index === 0 ? 0.5 : index === 1 ? -0.2 : 999,
  })));
  const winnersLosers = distributional.map((row) => ({
    ...row, decile: String(Number.parseInt(row.decile)), avg_change: row.reform_id === ALPHA ? 100 : row.reform_id === BETA ? -50 : 999,
  }));
  const household = measures.flatMap((measure) => [2026, 2027, 2028, 2029, 2030].map((year) => ({
    reform_id: measure.id, year, household_id: "synthetic-1", household_weight: 1,
    baseline_income: 30_000, income_change: measure.id === ALPHA ? 100 : measure.id === BETA ? -50 : 999,
  })));
  const ageRows = [...measures, { id: COMBINED, name: "Mock combined package" }].flatMap((measure) =>
    ["0-15", "16-24", "25-34", "35-49", "50-64", "65+", "all"].map((band) => [
      measure.id, measure.name, YEAR, band, 1_000_000, 5000,
      measure.id === ALPHA ? 100 : measure.id === BETA ? -50 : 50,
      25, 20, 30, 50, 200_000,
    ].join(",")),
  );
  const ageCsv = [
    "reform_id,reform_name,year,age_band,people,sample_size,mean_change,mean_equivalised_change,pct_better_off,pct_worse_off,pct_unchanged,people_directly_affected",
    ...ageRows,
  ].join("\n");
  // The tables loadPublication would return for the displayable keys: the
  // keys whose artifacts verified (a not-computable entry has none)
  const tablesByKey = Object.fromEntries(
    [...measures.filter((measure) => measure.id !== HELD).map((measure) => measure.id), COMBINED].map((id) => [id, {
      budgetary_impact: budgetary.filter((row) => row.reform_id === id),
      distributional_impact: distributional.filter((row) => row.reform_id === id),
      winners_losers: winnersLosers.filter((row) => row.reform_id === id),
    }]),
  );
  return { manifest, budgetary, distributional, winnersLosers, household, ageCsv, tablesByKey };
}

/**
 * Bind flat files to a test manifest as `publish index` does: the manifest
 * names each file's SHA-256, and the release index names the manifest's
 * revision and the SHA-256 of its bytes. Returns the files to serve.
 */
export async function bindFlatFiles(manifest, files, aliases = {}) {
  const { sha256Hex } = await import("../utils/publication/digest");
  const { RELEASE_INDEX_FILE, RELEASE_INDEX_SCHEMA } = await import("../utils/publication/flat");
  manifest.revision ??= 1;
  manifest.flat_aliases = aliases;
  manifest.flat_files = Object.fromEntries(
    await Promise.all(Object.entries(files).map(async ([name, text]) => [name, await sha256Hex(text)])),
  );
  const { areaProvenanceFixture } = await import("./areaProvenanceFixture");
  const { document, receipts } = await areaProvenanceFixture(manifest, manifest.flat_files, aliases);
  const provenance = JSON.stringify(document);
  manifest.flat_provenance_sha256 = await sha256Hex(provenance);
  const snapshot = await sha256Hex(JSON.stringify(manifest));
  Object.defineProperty(manifest, "snapshotSha256", { value: snapshot, configurable: true });
  const index = {
    schema: RELEASE_INDEX_SCHEMA, release: manifest.release, budget: manifest.budget,
    manifest_revision: manifest.revision, manifest_sha256: snapshot, files: manifest.flat_files, aliases,
    flat_provenance_sha256: manifest.flat_provenance_sha256,
  };
  return { ...receipts, [RELEASE_INDEX_FILE]: JSON.stringify(index), "area_provenance.json": provenance, ...files };
}

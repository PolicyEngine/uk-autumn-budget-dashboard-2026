import { loadArtifact, loadManifest, loadPublication } from "./publication/load";
import { parseCsv } from "./publication/csv";
import { isDisplayable } from "./publication/manifest";
import { buildMeasureCatalogue, isCatalogueRowDisplayable } from "./measureCatalogue";

export function parseDashboardCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) throw new Error("The published table is empty");
  return rows.filter((row) => row.some((cell) => cell !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

/** Every national figure is read from a receipt-verified artifact snapshot. */
export async function loadDashboard(basePath = "", { fetchImpl = fetch, signal } = {}) {
  const manifest = await loadManifest(basePath, { fetchImpl, signal });
  const data = { budgetary: [], distributional: [], winnersLosers: [], metrics: [] };
  if (!manifest) return { status: "no-manifest", catalogue: buildMeasureCatalogue(), ...data };
  // The package is every displayable measure: a held or not-computable
  // measure is shown as unavailable, so the combined run that describes the
  // page's figures is the one of the displayable measures.
  const packageIds = Object.keys(manifest.measures).filter((id) => isDisplayable(manifest.measures[id]));
  const publication = await loadPublication(basePath, packageIds, { fetchImpl, signal, manifest });
  const names = { budgetary: "budgetary_impact", distributional: "distributional_impact", winnersLosers: "winners_losers", metrics: "metrics" };
  for (const [name, table] of Object.entries(names)) data[name] = Object.values(publication.tablesByKey).flatMap((tables) => tables[table] ?? []);
  const catalogue = buildMeasureCatalogue({ manifest, ...data, tablesByKey: publication.tablesByKey, failures: publication.failures });
  for (const name of Object.keys(names)) data[name] = data[name].filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return { status: "ready", catalogue, ...data };
}

/**
 * One table from every artifact the page verified (#20's receipt route).
 *
 * The keys are the measures and combined run whose artifacts verified when
 * the page loaded. Each is read again through the same receipt checks, so a
 * key whose artifact now fails, or that carries no such table, contributes
 * no rows: its figures are unavailable, never taken from another file. The
 * keys that failed are listed in `failures`.
 *
 * @returns {Promise<{rows: Array<Object>, failures: Array<string>}>}
 */
export async function loadVerifiedTables(catalogue, table, { basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch, signal } = {}) {
  const manifest = catalogue?.manifest;
  if (!manifest || !catalogue.tablesByKey) throw new Error("No Budget results are published yet");
  const failures = [];
  const loaded = await Promise.all(Object.keys(catalogue.tablesByKey).map(async (key) => {
    const entry = Object.hasOwn(manifest.measures, key) ? manifest.measures[key] : Object.hasOwn(manifest.combined, key) ? manifest.combined[key] : undefined;
    try {
      return (await loadArtifact(basePath, key, entry, { fetchImpl, signal, tables: [table] }))[table] ?? [];
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      failures.push(key);
      return [];
    }
  }));
  const rows = loaded.flat().filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return { rows, failures };
}

/** As loadVerifiedTables, the rows only. */
export async function loadVerifiedTable(catalogue, table, options) {
  return (await loadVerifiedTables(catalogue, table, options)).rows;
}

/** Null is an unavailable figure, never a zero standing in for a missing row. */
export function budgetChartData(budgetary, measures, selected, years) {
  return years.map((year) => {
    const point = { year };
    let total = 0;
    let complete = selected.every((id) => measures.some((measure) => measure.id === id));
    for (const measure of measures) {
      const supported = measure.displayable && measure.years.includes(year) && !measure.unsupported_years.includes(year);
      const row = supported ? budgetary.find((item) => item.reform_id === measure.id && Number(item.year) === year) : undefined;
      const value = row?.value !== "" && row?.value != null ? Number(row.value) : NaN;
      point[measure.seriesKey] = selected.includes(measure.id) ? Number.isFinite(value) ? value : null : 0;
      if (selected.includes(measure.id)) {
        if (Number.isFinite(value)) total += value;
        else complete = false;
      }
    }
    point.netImpact = complete ? total : null;
    point.unpublished = !complete;
    return point;
  });
}

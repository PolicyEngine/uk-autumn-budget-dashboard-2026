import { loadArtifact } from "./publication/load";
import { loadDashboardParts } from "./publication/parts";

export { loadDashboardParts, sameParts } from "./publication/parts";
import { parseCsv } from "./publication/csv";
import { buildMeasureCatalogue, isCatalogueRowDisplayable } from "./measureCatalogue";

export function parseDashboardCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) throw new Error("The published table is empty");
  return rows.filter((row) => row.some((cell) => cell !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

/** Every national figure is read from a receipt-verified artifact snapshot. */
export async function loadDashboard(basePath = "", options = {}) {
  return dashboardFromParts(await loadDashboardParts(basePath, options));
}

/** The page's figures from loadDashboardParts' result: no request, no check. */
export function dashboardFromParts(parts) {
  const data = { budgetary: [], distributional: [], winnersLosers: [], metrics: [] };
  if (parts.status !== "ready") return { status: "no-manifest", catalogue: buildMeasureCatalogue(), ...data };
  const { manifest, tablesByKey, failures } = parts;
  // A manifest that crossed from the build lost its non-enumerable digest
  if (manifest.snapshotSha256 === undefined) Object.defineProperty(manifest, "snapshotSha256", { value: parts.snapshotSha256 });
  const names = { budgetary: "budgetary_impact", distributional: "distributional_impact", winnersLosers: "winners_losers", metrics: "metrics" };
  for (const [name, table] of Object.entries(names)) data[name] = Object.values(tablesByKey).flatMap((tables) => tables[table] ?? []);
  const catalogue = buildMeasureCatalogue({ manifest, ...data, tablesByKey, failures });
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
// One load per catalogue and table, shared by every view that reads it (Young
// people and Pensioners both read the age table) and by the idle prefetch.
// A catalogue is one verified snapshot, so its loads never mix snapshots.
const tableLoads = new WeakMap();

/**
 * As loadVerifiedTables, shared: the first call for a catalogue and table
 * loads it; later calls get the same result. A failed or aborted load is
 * not kept, so a later call tries again.
 */
export function loadVerifiedTablesOnce(catalogue, table, options = {}) {
  if (catalogue === null || typeof catalogue !== "object") return loadVerifiedTables(catalogue, table, options);
  let loads = tableLoads.get(catalogue);
  if (!loads) tableLoads.set(catalogue, (loads = new Map()));
  if (!loads.has(table)) {
    const record = { value: undefined };
    record.promise = loadVerifiedTables(catalogue, table, { ...options, signal: undefined }).then(
      (value) => {
        record.value = value;
        return value;
      },
      (error) => {
        loads.delete(table);
        throw error;
      },
    );
    loads.set(table, record);
  }
  return loads.get(table).promise;
}

/** The shared result for a catalogue and table, if it has already loaded. */
export function peekVerifiedTables(catalogue, table) {
  if (catalogue === null || typeof catalogue !== "object") return undefined;
  return tableLoads.get(catalogue)?.get(table)?.value;
}

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
  return (await loadVerifiedTablesOnce(catalogue, table, options)).rows;
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

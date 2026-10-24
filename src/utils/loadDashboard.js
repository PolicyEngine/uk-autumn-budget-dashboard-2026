import { loadManifest, loadPublication } from "./publication/load";
import { parseCsv } from "./publication/csv";
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
  const publication = await loadPublication(basePath, Object.keys(manifest.measures), { fetchImpl, signal, manifest });
  const names = { budgetary: "budgetary_impact", distributional: "distributional_impact", winnersLosers: "winners_losers", metrics: "metrics" };
  for (const [name, table] of Object.entries(names)) data[name] = Object.values(publication.tablesByKey).flatMap((tables) => tables[table] ?? []);
  const catalogue = buildMeasureCatalogue({ manifest, ...data, tablesByKey: publication.tablesByKey, failures: publication.failures });
  for (const name of Object.keys(names)) data[name] = data[name].filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return { status: "ready", catalogue, ...data };
}

/** Null is an unavailable figure, never a zero standing in for a missing row. */
export function budgetChartData(budgetary, measures, selected, years) {
  return years.map((year) => {
    const point = { year };
    let total = 0;
    let complete = true;
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

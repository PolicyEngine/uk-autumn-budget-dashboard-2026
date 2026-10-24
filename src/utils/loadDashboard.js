import { loadManifest } from "./publication/load";
import { parseCsv } from "./publication/csv";
import { buildMeasureCatalogue, isCatalogueRowDisplayable } from "./measureCatalogue";

export function parseDashboardCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) throw new Error("The published table is empty");
  return rows.filter((row) => row.some((cell) => cell !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

/** Keep the rehearsed flat figure route; a present manifest always gates it. */
export async function loadDashboard(basePath = "", { fetchImpl = fetch, signal } = {}) {
  const names = ["budgetary", "distributional", "winnersLosers", "metrics"];
  const files = ["budgetary_impact", "distributional_impact", "winners_losers", "metrics"];
  const [manifest, ...tables] = await Promise.all([
    loadManifest(basePath, { fetchImpl, signal }),
    ...files.map(async (file) => {
      const response = await fetchImpl(`${basePath}/data/${file}.csv`, { signal });
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      return parseDashboardCsv(await response.text());
    }),
  ]);
  const data = Object.fromEntries(names.map((name, index) => [name, tables[index]]));
  const catalogue = buildMeasureCatalogue({ manifest, ...data });
  const allowed = new Set(catalogue.displayable.map((measure) => measure.id));
  if (catalogue.combinedId) allowed.add(catalogue.combinedId);
  // Figures for a staged, withdrawn, stale or not-computable entry are never
  // exposed to the page, even when an older flat file still carries its rows.
  for (const name of names) data[name] = data[name].filter((row) => allowed.has(row.reform_id) && isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return { catalogue, ...data };
}

/** Null is an unavailable figure, never a zero standing in for a missing row. */
export function budgetChartData(budgetary, measures, selected, years) {
  return years.map((year) => {
    const point = { year };
    let total = 0;
    let complete = true;
    for (const measure of measures) {
      const row = budgetary.find((item) => item.reform_id === measure.id && Number(item.year) === year);
      const value = row?.value !== "" && row?.value != null ? Number(row.value) : NaN;
      point[measure.name] = selected.includes(measure.id) ? Number.isFinite(value) ? value : null : 0;
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

import { buildChartCsv, fiscalYear } from "../chartCsv";

/**
 * CSV text for a Living standards chart: one row per x value, a column per
 * series, the chart's own values. Fiscal years are written "2025-26".
 */
export function seriesCsv({
  title,
  units,
  source,
  rows,
  series,
  xKey = "year",
  xLabel = "Fiscal year",
  xFormat = fiscalYear,
  decimals = 4,
}) {
  return buildChartCsv({
    title,
    units,
    source,
    columns: [
      { key: "_x", label: xLabel },
      ...series.filter((s) => !s.hidden).map((s) => ({ key: s.key, label: s.name, decimals })),
    ],
    rows: rows.map((row) => ({ ...row, _x: xFormat(row[xKey]) })),
  });
}

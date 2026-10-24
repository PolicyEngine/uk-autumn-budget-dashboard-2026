import { useEffect, useMemo, useState } from "react";
import { loadVerifiedFlatCsv } from "../utils/publication/flat";
import { parseTable } from "../utils/publication/csv";
import { isCombinedId, isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";

// Cache only within an immutable loaded snapshot, never across revisions.
const curveRows = new WeakMap();
function loadCurve(catalogue) {
  if (!curveRows.has(catalogue)) {
    curveRows.set(catalogue, loadVerifiedFlatCsv("income_curve.csv", catalogue).then(parseCurve));
  }
  return curveRows.get(catalogue);
}

/** Rows are parsed with the real publication schema, including quoted cells. */
export function parseCurve(csvText) {
  return parseTable("income_curve", csvText).map((row) => ({
    reformId: row.reform_id, year: row.year, household: row.household,
    income: row.income, baseline: row.baseline_net_income, reformNet: row.reform_net_income,
  }));
}

/**
 * One household's net income across its income grid in one year: before
 * the Budget, and after the selected measures.
 *
 * "Before the Budget" is the combined package's baseline, where every
 * measure is at its pre-Budget setting (a measure's own baseline differs:
 * it reverses that measure alone). After the Budget adds each selected
 * measure's change to it, as the population charts do.
 *
 * @returns {Array<{income: number, baseline: number, reform: number,
 *   difference: number}>} in income order; empty when the file has no
 *   rows for the household and year
 */
export function curveFor(rows, { household, year, policies, combinedId }) {
  const points = new Map();
  for (const row of rows) {
    if (row.household !== household || row.year !== year) continue;
    if (!policies.includes(row.reformId) && !(combinedId === undefined ? isCombinedId(row.reformId) : row.reformId === combinedId)) continue;
    let point = points.get(row.income);
    if (!point) {
      point = { income: row.income, baseline: null, combined: false, difference: 0, present: new Set() };
      points.set(row.income, point);
    }
    if ((combinedId === undefined ? isCombinedId(row.reformId) : row.reformId === combinedId) && !point.combined && Number.isFinite(row.baseline)) {
      point.baseline = row.baseline;
      point.combined = true;
    }
    if (policies.includes(row.reformId) && Number.isFinite(row.reformNet) && Number.isFinite(row.baseline)) {
      point.difference += row.reformNet - row.baseline;
      point.present.add(row.reformId);
    }
  }
  if ([...points.values()].some((point) => !point.combined || policies.some((id) => !point.present.has(id)))) return [];
  return [...points.values()]
    .sort((a, b) => a.income - b.income)
    .map(({ income, baseline, difference }) => ({
      income,
      baseline,
      difference,
      reform: baseline + difference,
    }));
}

/** The chart data for a household, year and selection of measures. */
export default function useIncomeCurve({ household, year, policies }) {
  const catalogue = useMeasureCatalogue();
  const { combinedId } = catalogue;
  const [loaded, setLoaded] = useState(null);
  const rows = loaded?.catalogue === catalogue ? loaded.rows : null;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadCurve(catalogue)
      .then((loaded) => live && setLoaded({ catalogue, rows: loaded }))
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [catalogue]);

  const loading = rows === null && !failed;
  const data = useMemo(
    () => (rows ? curveFor(rows.filter((row) => isCatalogueRowDisplayable(catalogue, row.reformId, row.year)), { household, year, policies, combinedId }) : []),
    [rows, household, year, policies, combinedId, catalogue],
  );
  return { loading, data };
}

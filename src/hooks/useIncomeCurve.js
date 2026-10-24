import { useEffect, useMemo, useState } from "react";
import { parseTable } from "../utils/publication/csv";
import { loadVerifiedTables } from "../utils/loadDashboard";
import { useMeasureCatalogue } from "../utils/measureCatalogue";

/** Curve rows from typed income_curve rows. */
const curveRows = (rows) =>
  rows.map((row) => ({
    reformId: row.reform_id, year: row.year, household: row.household,
    income: row.income, baseline: row.baseline_net_income, reformNet: row.reform_net_income,
  }));

/** Rows are parsed with the real publication schema, including quoted cells. */
export function parseCurve(csvText) {
  return curveRows(parseTable("income_curve", csvText));
}

// Cache only within one loaded snapshot, never across revisions, and only
// a load in which every artifact verified: after a failure the next chart to
// mount loads again.
const loads = new WeakMap();
function loadCurve(catalogue) {
  if (!loads.has(catalogue)) {
    const load = loadVerifiedTables(catalogue, "income_curve").then(({ rows, failures }) => {
      if (failures.length) loads.delete(catalogue);
      return curveRows(rows);
    });
    load.catch(() => loads.delete(catalogue));
    loads.set(catalogue, load);
  }
  return loads.get(catalogue);
}

/**
 * One household's net income across its income grid in one year: the
 * change from the selected measures, and, where the approved package
 * baseline is published, net income before and after.
 *
 * "Before the Budget" is the combined package's baseline, where every
 * measure is at its pre-Budget setting (a measure's own baseline differs:
 * it reverses that measure alone). After the Budget adds each selected
 * measure's change to it, as the population charts do. Without the
 * package's own row at every point, `baseline` and `reform` are null: a
 * member's baseline never stands in for it.
 *
 * @returns {Array<{income: number, baseline: number|null,
 *   reform: number|null, difference: number}>} in income order; empty
 *   unless every selected measure has a row at every point
 */
export function curveFor(rows, { household, year, policies, combinedId = null }) {
  const points = new Map();
  for (const row of rows) {
    if (row.household !== household || row.year !== year) continue;
    const isPackage = typeof combinedId === "string" && row.reformId === combinedId;
    const isMember = policies.includes(row.reformId);
    if (!isPackage && !isMember) continue;
    let point = points.get(row.income);
    if (!point) {
      point = { income: row.income, baseline: null, difference: 0, present: new Set() };
      points.set(row.income, point);
    }
    if (isPackage && Number.isFinite(row.baseline)) point.baseline = row.baseline;
    if (isMember && !point.present.has(row.reformId) && Number.isFinite(row.reformNet) && Number.isFinite(row.baseline)) {
      point.difference += row.reformNet - row.baseline;
      point.present.add(row.reformId);
    }
  }
  const all = [...points.values()];
  if (!all.length || all.some((point) => policies.some((id) => !point.present.has(id)))) return [];
  const levels = all.every((point) => point.baseline !== null);
  return all
    .sort((a, b) => a.income - b.income)
    .map(({ income, baseline, difference }) => ({
      income,
      baseline: levels ? baseline : null,
      difference,
      reform: levels ? baseline + difference : null,
    }));
}

/** True when a curve can be drawn as net income levels, not just changes. */
export const hasLevels = (curve) => curve.length > 0 && curve.every((point) => Number.isFinite(point.baseline) && Number.isFinite(point.reform));

/** The chart data for a household, year and selection of measures. */
export default function useIncomeCurve({ household, year, policies }) {
  const catalogue = useMeasureCatalogue();
  const { combinedId } = catalogue;
  const [loaded, setLoaded] = useState(null);
  const rows = loaded?.catalogue === catalogue ? loaded.rows : null;
  const failed = loaded?.catalogue === catalogue && loaded.failed;

  useEffect(() => {
    let live = true;
    loadCurve(catalogue)
      .then((curve) => live && setLoaded({ catalogue, rows: curve, failed: false }))
      .catch(() => live && setLoaded({ catalogue, rows: null, failed: true }));
    return () => {
      live = false;
    };
  }, [catalogue]);

  const loading = rows === null && !failed;
  const data = useMemo(
    () => (rows ? curveFor(rows, { household, year, policies, combinedId }) : []),
    [rows, household, year, policies, combinedId],
  );
  return { loading, data, levels: hasLevels(data) };
}

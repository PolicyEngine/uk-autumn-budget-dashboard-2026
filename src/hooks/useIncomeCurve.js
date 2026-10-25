import { useEffect, useMemo, useState } from "react";
import { COMBINED_REFORM_ID } from "../utils/policyConfig";

// One fetch of income_curve.csv for the page, shared by both household
// charts: the file covers every household, measure and year.
let curveRows = null;

function loadCurve() {
  if (!curveRows) {
    curveRows = fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/income_curve.csv`)
      .then((response) => {
        if (!response.ok) throw new Error(`income_curve.csv: HTTP ${response.status}`);
        return response.text();
      })
      .then(parseCurve)
      .catch((error) => {
        curveRows = null;
        throw error;
      });
  }
  return curveRows;
}

/** Rows of income_curve.csv, typed. */
export function parseCurve(csvText) {
  const lines = csvText.trim().split("\n");
  const headers = lines[0].trim().split(",");
  const column = (name) => headers.indexOf(name);
  const at = {
    reformId: column("reform_id"),
    year: column("year"),
    household: column("household"),
    income: column("income"),
    baseline: column("baseline_net_income"),
    reformNet: column("reform_net_income"),
  };
  return lines.slice(1).map((line) => {
    // reform_name may hold a comma inside quotes, so read the columns
    // after it from the end of the line
    const values = line.trim().split(",");
    const fromEnd = (index) => values[values.length - (headers.length - index)];
    return {
      reformId: values[at.reformId],
      year: Number(fromEnd(at.year)),
      household: fromEnd(at.household),
      income: Number(fromEnd(at.income)),
      baseline: Number(fromEnd(at.baseline)),
      reformNet: Number(fromEnd(at.reformNet)),
    };
  });
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
export function curveFor(rows, { household, year, policies }) {
  const points = new Map();
  for (const row of rows) {
    if (row.household !== household || row.year !== year) continue;
    let point = points.get(row.income);
    if (!point) {
      point = { income: row.income, baseline: row.baseline, combined: false, difference: 0 };
      points.set(row.income, point);
    }
    if (row.reformId === COMBINED_REFORM_ID && !point.combined) {
      point.baseline = row.baseline;
      point.combined = true;
    }
    if (policies.includes(row.reformId)) point.difference += row.reformNet - row.baseline;
  }
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
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadCurve()
      .then((loaded) => live && setRows(loaded))
      .catch((error) => {
        console.error("Error loading income curve data:", error);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const loading = rows === null && !failed;
  const data = useMemo(
    () => (rows ? curveFor(rows, { household, year, policies }) : []),
    [rows, household, year, policies],
  );
  return { loading, data };
}

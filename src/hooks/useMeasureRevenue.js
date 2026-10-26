import { useEffect, useState } from "react";
import { parseCsv } from "../utils/publication/csv";

// One fetch of budgetary_impact.csv for every note that quotes a measure's
// revenue (ChartMoreInfo); the page's charts read the same file
let revenueRows = null;

function loadRevenue() {
  if (!revenueRows) {
    revenueRows = fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/budgetary_impact.csv`)
      .then((response) => {
        if (!response.ok) throw new Error(`budgetary_impact.csv: HTTP ${response.status}`);
        return response.text();
      })
      .then(parseRevenue)
      .catch((error) => {
        revenueRows = null;
        throw error;
      });
  }
  return revenueRows;
}

/** budgetary_impact.csv as {[reformId]: {[year]: £bn}}. */
export function parseRevenue(csvText) {
  // Quoted names may hold commas ("raised by £1,000"): parse, don't split
  const [keys, ...lines] = parseCsv(csvText.trim()).filter((row) => row.length > 1);
  const at = (name) => keys.indexOf(name);
  const byId = {};
  for (const cells of lines) {
    const id = cells[at("reform_id")];
    (byId[id] ??= {})[Number(cells[at("year")])] = Number(cells[at("value")]);
  }
  return byId;
}

/**
 * A measure's change in government revenue in a year, £bn (negative is a
 * cost), from the published budgetary_impact.csv; null until loaded, or
 * when the file or the row is missing.
 */
export default function useMeasureRevenue(id, year, enabled = true) {
  const [table, setTable] = useState(null);
  useEffect(() => {
    if (!enabled || typeof fetch !== "function") return undefined;
    let live = true;
    loadRevenue()
      .then((rows) => live && setTable(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  const value = table?.[id]?.[year];
  return Number.isFinite(value) ? value : null;
}

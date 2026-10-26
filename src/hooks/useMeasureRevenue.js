import { useEffect, useState } from "react";

// One fetch of budgetary_impact.csv for every note that quotes a measure's
// revenue (ZeroMeasuresNote); the page's charts read the same file
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
  const [header, ...lines] = csvText.trim().split("\n");
  const keys = header.trim().split(",");
  const at = (name) => keys.indexOf(name);
  const byId = {};
  for (const line of lines) {
    const cells = line.split(",");
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

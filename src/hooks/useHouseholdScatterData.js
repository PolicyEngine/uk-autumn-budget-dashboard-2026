import { useEffect, useMemo, useState } from "react";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { loadDashboard, loadVerifiedTablesOnce, peekVerifiedTables } from "../utils/loadDashboard";

export const LOADING = Object.freeze({ status: "loading", rows: null, error: null });

const TABLE = "household_scatter_binned";

function rowsState(rows) {
  return rows.length ? { status: "ready", rows, error: null } : { status: "unavailable", rows: null, error: "Household results are unavailable" };
}

// Whether the catalogue's own load read the scatter (a standalone load, a
// test's catalogue); the page's catalogue leaves it to load on demand
const carriesScatter = (catalogue) => Object.values(catalogue.tablesByKey ?? {}).some((tables) => tables && Object.hasOwn(tables, TABLE));

function scatterState(catalogue) {
  if (!catalogue.manifest || !catalogue.tablesByKey) return { status: "unavailable", rows: null, error: "No verified household results are published" };
  const rows = Object.values(catalogue.tablesByKey).flatMap((tables) => tables[TABLE] ?? []).filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return rowsState(rows);
}

/** Standalone consumers use the same receipt-verified route as the page. */
export async function loadHouseholdScatter({ fetchImpl = fetch, base = process.env.NEXT_PUBLIC_BASE_PATH || "" } = {}) {
  try {
    return scatterState((await loadDashboard(base, { fetchImpl })).catalogue);
  } catch (error) {
    return { status: "error", rows: null, error: error.message };
  }
}

/**
 * The binned household results for the page's catalogue. The page loads
 * them on demand, each artifact's file checked against its verified receipt
 * (loadVerifiedTablesOnce), so they never hold up the first chart.
 */
export function useHouseholdScatterData() {
  const catalogue = useMeasureCatalogue();
  const lazy = Boolean(catalogue.manifest && catalogue.tablesByKey) && !carriesScatter(catalogue);
  const initial = useMemo(() => {
    if (!lazy) return scatterState(catalogue);
    const peeked = peekVerifiedTables(catalogue, TABLE);
    return peeked ? rowsState(peeked.rows) : LOADING;
  }, [catalogue, lazy]);
  const [loaded, setLoaded] = useState({ catalogue: null, state: LOADING });
  useEffect(() => {
    if (!lazy || initial.status !== "loading") return undefined;
    let cancelled = false;
    loadVerifiedTablesOnce(catalogue, TABLE)
      .then(({ rows }) => { if (!cancelled) setLoaded({ catalogue, state: rowsState(rows) }); })
      .catch((error) => { if (!cancelled) setLoaded({ catalogue, state: { status: "error", rows: null, error: error.message } }); });
    return () => { cancelled = true; };
  }, [catalogue, lazy, initial]);
  if (initial.status !== "loading") return initial;
  return loaded.catalogue === catalogue ? loaded.state : LOADING;
}

// Kept for consumers' test cleanup; there is no independent figure cache.
export function resetHouseholdScatterCache() {}
export default useHouseholdScatterData;

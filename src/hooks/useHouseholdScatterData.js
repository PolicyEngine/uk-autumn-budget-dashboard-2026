import { useMemo } from "react";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { loadDashboard } from "../utils/loadDashboard";

export const LOADING = Object.freeze({ status: "loading", rows: null, error: null });

function scatterState(catalogue) {
  if (!catalogue.manifest || !catalogue.tablesByKey) return { status: "unavailable", rows: null, error: "No verified household results are published" };
  const rows = Object.values(catalogue.tablesByKey).flatMap((tables) => tables.household_scatter_binned ?? []).filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
  return rows.length ? { status: "ready", rows, error: null } : { status: "unavailable", rows: null, error: "Household results are unavailable" };
}

/** Standalone consumers use the same receipt-verified route as the page. */
export async function loadHouseholdScatter({ fetchImpl = fetch, base = process.env.NEXT_PUBLIC_BASE_PATH || "" } = {}) {
  try {
    return scatterState((await loadDashboard(base, { fetchImpl })).catalogue);
  } catch (error) {
    return { status: "error", rows: null, error: error.message };
  }
}

export function useHouseholdScatterData() {
  const catalogue = useMeasureCatalogue();
  return useMemo(() => scatterState(catalogue), [catalogue]);
}

// Kept for consumers' test cleanup; there is no independent figure cache.
export function resetHouseholdScatterCache() {}
export default useHouseholdScatterData;

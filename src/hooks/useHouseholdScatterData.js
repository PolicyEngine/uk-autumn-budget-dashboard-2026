import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { parseScatterCsv, SCATTER_FILE } from "../utils/householdScatter";

/**
 * The binned household scatter, fetched once and shared.
 *
 * The state is `loading`, `ready` (with `rows`), `unavailable` (HTTP 404)
 * or `error` (the file could not be fetched or is not in the published
 * format; the page then shows nothing from it).
 */

export const LOADING = Object.freeze({ status: "loading", rows: null, error: null });

const basePath = () => process.env.NEXT_PUBLIC_BASE_PATH || "";

const failure = (status, error) => Object.freeze({ status, rows: null, error });

/**
 * @returns {Promise<Object>} A state as above; never rejects.
 */
export async function loadHouseholdScatter({
  fetchImpl = fetch,
  base = basePath(),
} = {}) {
  let response;
  try {
    response = await fetchImpl(`${base}/data/${SCATTER_FILE}`, { cache: "no-cache" });
  } catch {
    return failure("error", `${SCATTER_FILE} could not be fetched`);
  }
  if (response.status === 404) return failure("unavailable", null);
  if (!response.ok) return failure("error", `${SCATTER_FILE}: HTTP ${response.status}`);
  try {
    const rows = parseScatterCsv(await response.text());
    return Object.freeze({ status: "ready", rows, error: null });
  } catch (error) {
    return failure("error", error.message);
  }
}

const entries = new Map();

function entryFor(key) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: null, listeners: new Set() };
    entries.set(key, entry);
    const settle = (state) => {
      entry.state = state;
      for (const listener of entry.listeners) listener();
    };
    loadHouseholdScatter().then(settle, () =>
      settle(failure("error", "the file could not be loaded")),
    );
  }
  return entry;
}

/** The binned scatter's state: `{status, rows, error}`. */
export function useHouseholdScatterData() {
  const key = basePath();
  const subscribe = useCallback(
    (onChange) => {
      const entry = entryFor(key);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    [key],
  );
  const getSnapshot = () => entries.get(key)?.state ?? LOADING;
  const state = useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
  const catalogue = useMeasureCatalogue();
  return useMemo(() => {
    if (state.status !== "ready" || (!catalogue.manifest && catalogue.measures.length === 0)) return state;
    return { ...state, rows: state.rows.filter((row) =>
      isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
    ) };
  }, [state, catalogue]);
}

/** Forget the fetched file (for tests). */
export function resetHouseholdScatterCache() {
  entries.clear();
}

export default useHouseholdScatterData;

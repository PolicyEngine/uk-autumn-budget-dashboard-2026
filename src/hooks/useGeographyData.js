import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { indexRows } from "../utils/geography/rows";
import { FILES } from "../utils/geography/columns";
import { parseGeographyTable } from "../utils/geography/parse";

/**
 * Results by area, fetched once per file and shared by every component.
 *
 * Each file's state is one of:
 *
 * - `loading`: not fetched yet.
 * - `ready`: `table` holds every row, checked (see utils/geography/parse).
 * - `unavailable`: the file is not published (HTTP 404).
 * - `error`: the file could not be fetched, or is not in the published
 *   format; `error` says why, in words that never quote a figure. The page
 *   shows nothing from it.
 *
 * The state is keyed by file, so a response can only ever update its own
 * file's state: a component that switches files never sees the previous
 * file's answer.
 */

export const BOUNDARIES_FILE = "uk_constituencies_2024.geojson";

export const LOADING = Object.freeze({
  status: "loading",
  table: null,
  features: null,
  error: null,
});

const basePath = () => process.env.NEXT_PUBLIC_BASE_PATH || "";

// The files of results by area the build ships (next.config.ts), or null
// when not set (tests, dev without the config): then every file is fetched.
const publishedFiles = () => {
  const list = process.env.NEXT_PUBLIC_PUBLISHED_GEOGRAPHY;
  return list === undefined ? null : list.split(",").filter(Boolean);
};

const failure = (status, error) =>
  Object.freeze({ status, table: null, features: null, error });

/**
 * Fetch and check one file of results by area.
 *
 * @param {"regional"|"constituency"} name
 * @returns {Promise<Object>} A state as above; never rejects.
 */
export async function loadGeographyFile(
  name,
  { fetchImpl = fetch, base = basePath(), published = publishedFiles() } = {},
) {
  const { file, level } = FILES[name];
  // Not in this build: not published, and not requested
  if (published && !published.includes(file)) return failure("unavailable", null);
  const url = `${base}/data/${file}`;
  let response;
  try {
    response = await fetchImpl(url, { cache: "no-cache" });
  } catch {
    return failure("error", `${file} could not be fetched`);
  }
  if (response.status === 404) return failure("unavailable", null);
  if (!response.ok) return failure("error", `${file}: HTTP ${response.status}`);
  try {
    const bytes = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const table = parseGeographyTable(text, { level });
    return Object.freeze({ status: "ready", table, features: null, error: null });
  } catch (error) {
    return failure("error", `${file}: ${error.message}`);
  }
}

/**
 * Fetch the constituency boundaries.
 *
 * @returns {Promise<Object>} `ready` with `features`, or `unavailable` or
 *   `error`; never rejects.
 */
export async function loadBoundaries({
  fetchImpl = fetch,
  base = basePath(),
} = {}) {
  try {
    const response = await fetchImpl(`${base}/data/${BOUNDARIES_FILE}`);
    if (response.status === 404) return failure("unavailable", null);
    if (!response.ok) {
      return failure("error", `${BOUNDARIES_FILE}: HTTP ${response.status}`);
    }
    const geojson = await response.json();
    if (!Array.isArray(geojson?.features)) {
      return failure("error", `${BOUNDARIES_FILE}: not a feature collection`);
    }
    return Object.freeze({
      status: "ready",
      table: null,
      features: geojson.features,
      error: null,
    });
  } catch {
    return failure("error", `${BOUNDARIES_FILE} could not be read`);
  }
}

const LOADERS = {
  regional: () => loadGeographyFile("regional"),
  constituency: () => loadGeographyFile("constituency"),
  boundaries: () => loadBoundaries(),
};

// One entry per resource and base path: its settled state, and who to tell.
const entries = new Map();

function entryFor(key, name) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: null, listeners: new Set() };
    entries.set(key, entry);
    const settle = (state) => {
      entry.state = state;
      for (const listener of entry.listeners) listener();
    };
    const load = Object.hasOwn(LOADERS, name)
      ? LOADERS[name]
      : async () => failure("error", `${name} is not a geography resource`);
    load().then(settle, () =>
      settle(failure("error", "the file could not be loaded")),
    );
  }
  return entry;
}

function useCachedResource(name) {
  const key = `${basePath()}|${name}`;
  const subscribe = useCallback(
    (onChange) => {
      const entry = entryFor(key, name);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    [key, name],
  );
  const getSnapshot = () => entries.get(key)?.state ?? LOADING;
  return useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
}

/**
 * The state of one file of results by area.
 *
 * @param {"regional"|"constituency"} name
 * @returns {{status: "loading"|"ready"|"unavailable"|"error",
 *   table: Object|null, error: string|null}}
 */
export function useGeographyData(name) {
  const state = useCachedResource(Object.hasOwn(FILES, name) ? name : `unknown:${name}`);
  const catalogue = useMeasureCatalogue();
  return useMemo(() => {
    if (state.status !== "ready" || (!catalogue.manifest && catalogue.measures.length === 0)) return state;
    const rows = state.table.rows.filter((row) =>
      isCatalogueRowDisplayable(catalogue, row.reform, row.year),
    );
    return { ...state, table: indexRows(state.table.level, rows) };
  }, [state, catalogue]);
}

/** The constituency boundaries: `{status, features, error}`. */
export const useConstituencyBoundaries = () => useCachedResource("boundaries");

/** Forget every fetched file (for tests). */
export function resetGeographyCache() {
  entries.clear();
}

export default useGeographyData;

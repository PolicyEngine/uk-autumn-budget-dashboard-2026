import { useCallback, useSyncExternalStore } from "react";
import { FILES } from "../utils/geography/columns";
import { parseGeographyTable } from "../utils/geography/parse";

/**
 * Results by area (and by demographic group, through useDemographicsData),
 * fetched once per file and shared by every component.
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

const failure = (status, error) =>
  Object.freeze({ status, table: null, features: null, error });

/**
 * Fetch one published file under /data and check it with `parse`.
 *
 * @param {string} file - The file's name.
 * @param {(text: string) => Object} parse - Returns the checked table, or
 *   throws naming the rule the file breaks.
 * @returns {Promise<Object>} A state as above; never rejects.
 */
export async function loadPublishedFile(
  file,
  parse,
  { fetchImpl = fetch, base = basePath() } = {},
) {
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
    const table = parse(text);
    return Object.freeze({ status: "ready", table, features: null, error: null });
  } catch (error) {
    return failure("error", `${file}: ${error.message}`);
  }
}

/**
 * Fetch and check one file of results by area or group.
 *
 * @param {"regional"|"constituency"|"demographics"} name
 * @returns {Promise<Object>} A state as above; never rejects.
 */
export function loadGeographyFile(name, options) {
  const { file, levels } = FILES[name];
  return loadPublishedFile(
    file,
    (text) => parseGeographyTable(text, { levels }),
    options,
  );
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
  demographics: () => loadGeographyFile("demographics"),
  boundaries: () => loadBoundaries(),
};

const unknownResource = async () =>
  failure("error", "not a geography resource");

// One entry per resource and base path: its settled state, and who to tell.
const entries = new Map();

function entryFor(key, load) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: null, listeners: new Set() };
    entries.set(key, entry);
    const settle = (state) => {
      entry.state = state;
      for (const listener of entry.listeners) listener();
    };
    load().then(settle, () =>
      settle(failure("error", "the file could not be loaded")),
    );
  }
  return entry;
}

/**
 * One resource's state, loaded once by `load` (a module-level function that
 * never rejects) and shared by every component that asks for `name`.
 */
export function useCachedResource(name, load) {
  const key = `${basePath()}|${name}`;
  const subscribe = useCallback(
    (onChange) => {
      const entry = entryFor(key, load);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    [key, load],
  );
  const getSnapshot = () => entries.get(key)?.state ?? LOADING;
  return useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
}

/**
 * The state of one file of results by area or group.
 *
 * @param {"regional"|"constituency"|"demographics"} name
 * @returns {{status: "loading"|"ready"|"unavailable"|"error",
 *   table: Object|null, error: string|null}}
 */
export function useGeographyData(name) {
  const known = Object.hasOwn(FILES, name);
  return useCachedResource(
    known ? name : `unknown:${name}`,
    known ? LOADERS[name] : unknownResource,
  );
}

/** The constituency boundaries: `{status, features, error}`. */
export const useConstituencyBoundaries = () =>
  useCachedResource("boundaries", LOADERS.boundaries);

/** Forget every fetched file (for tests). */
export function resetGeographyCache() {
  entries.clear();
}

export default useGeographyData;

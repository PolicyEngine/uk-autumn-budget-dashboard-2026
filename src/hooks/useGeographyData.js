import { useCallback, useSyncExternalStore } from "react";
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

/**
 * Whether the release routes results by area, as uk_budget_data.area_routing
 * writes it from the installed bundle.
 */
export const AREA_ROUTING_FILE = "area-routing.json";

/**
 * The routing kinds the area run serves (SERVED_KINDS in
 * uk_budget_data.area_routing). The file says `available` only with one of
 * them, and `not_available` with one of them or none. The page reads only
 * those five answers, the ones both public file checks accept.
 */
export const SERVED_KINDS = Object.freeze(["local_area", "area_coded_national"]);

const ROUTING_FIELDS = "area_views,regional_release_kind";

const isRoutingStatus = (body) => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  if (Object.keys(body).sort().join() !== ROUTING_FIELDS) return false;
  const served = SERVED_KINDS.includes(body.regional_release_kind);
  if (body.area_views === "available") return served;
  if (body.area_views === "not_available") {
    return served || body.regional_release_kind === null;
  }
  return false;
};

export const LOADING = Object.freeze({
  status: "loading",
  table: null,
  features: null,
  routing: null,
  error: null,
});

const basePath = () => process.env.NEXT_PUBLIC_BASE_PATH || "";

/** The folder under the base path that holds the page's own data files. */
export const DEFAULT_DATA_DIR = "/data";

// The files of results by area the build ships (next.config.ts), or null
// when not set (tests, dev without the config): then every file is fetched.
const publishedFiles = () => {
  const list = process.env.NEXT_PUBLIC_PUBLISHED_GEOGRAPHY;
  return list === undefined ? null : list.split(",").filter(Boolean);
};

const failure = (status, error) =>
  Object.freeze({ status, table: null, features: null, routing: null, error });

/**
 * Fetch and check one file of results by area.
 *
 * @param {"regional"|"constituency"} name
 * @returns {Promise<Object>} A state as above; never rejects.
 */
export async function loadGeographyFile(
  name,
  {
    fetchImpl = fetch,
    base = basePath(),
    published = publishedFiles(),
    dataDir = DEFAULT_DATA_DIR,
  } = {},
) {
  const { file, level } = FILES[name];
  // Not in this build: not published, and not requested. The build's list
  // covers public/data itself; a drill's folder (dataDir) is fetched as is.
  if (dataDir === DEFAULT_DATA_DIR && published && !published.includes(file)) {
    return failure("unavailable", null);
  }
  const url = `${base}${dataDir}/${file}`;
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

/**
 * Fetch whether the release routes results by area.
 *
 * @returns {Promise<Object>} `ready` with `routing`
 *   (`{areaViews, regionalReleaseKind}`) for one of the five answers above,
 *   or `unavailable` (HTTP 404) or `error`; never rejects. Only `ready`
 *   says anything about the release: for the others the area views say
 *   their results could not be loaded, and show none (viewState).
 */
export async function loadAreaRouting({
  fetchImpl = fetch,
  base = basePath(),
} = {}) {
  let response;
  try {
    response = await fetchImpl(`${base}/data/${AREA_ROUTING_FILE}`, {
      cache: "no-cache",
    });
  } catch {
    return failure("error", `${AREA_ROUTING_FILE} could not be fetched`);
  }
  if (response.status === 404) return failure("unavailable", null);
  if (!response.ok) {
    return failure("error", `${AREA_ROUTING_FILE}: HTTP ${response.status}`);
  }
  try {
    const body = await response.json();
    if (!isRoutingStatus(body)) {
      return failure("error", `${AREA_ROUTING_FILE}: not an area routing status`);
    }
    return Object.freeze({
      status: "ready",
      table: null,
      features: null,
      routing: Object.freeze({
        areaViews: body.area_views,
        regionalReleaseKind: body.regional_release_kind,
      }),
      error: null,
    });
  } catch {
    return failure("error", `${AREA_ROUTING_FILE} could not be read`);
  }
}

const LOADERS = {
  regional: (dataDir) => loadGeographyFile("regional", { dataDir }),
  constituency: (dataDir) => loadGeographyFile("constituency", { dataDir }),
  boundaries: () => loadBoundaries(),
  routing: () => loadAreaRouting(),
};

// One entry per resource and base path: its settled state, and who to tell.
const entries = new Map();

function entryFor(key, name, dataDir) {
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
    load(dataDir).then(settle, () =>
      settle(failure("error", "the file could not be loaded")),
    );
  }
  return entry;
}

function useCachedResource(name, dataDir = DEFAULT_DATA_DIR) {
  const key = `${basePath()}${dataDir}|${name}`;
  const subscribe = useCallback(
    (onChange) => {
      const entry = entryFor(key, name, dataDir);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    [key, name, dataDir],
  );
  const getSnapshot = () => entries.get(key)?.state ?? LOADING;
  return useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
}

/**
 * The state of one file of results by area.
 *
 * @param {"regional"|"constituency"} name
 * @param {string} [dataDir] - The folder under the base path (a drill's own)
 * @returns {{status: "loading"|"ready"|"unavailable"|"error",
 *   table: Object|null, error: string|null}}
 */
export function useGeographyData(name, dataDir = DEFAULT_DATA_DIR) {
  return useCachedResource(Object.hasOwn(FILES, name) ? name : `unknown:${name}`, dataDir);
}

/** The constituency boundaries: `{status, features, error}`. */
export const useConstituencyBoundaries = () => useCachedResource("boundaries");

/**
 * Whether the release routes results by area: `{status, routing, error}`,
 * fetched once and shared.
 */
export const useAreaRouting = () => useCachedResource("routing");

/** Forget every fetched file (for tests). */
export function resetGeographyCache() {
  entries.clear();
}

export default useGeographyData;

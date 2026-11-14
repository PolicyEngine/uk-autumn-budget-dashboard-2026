import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { loadVerifiedFlat, SnapshotChangedError } from "../utils/publication/flat";
import { indexRows } from "../utils/geography/rows";
import { FILES } from "../utils/geography/columns";
import { parseGeographyTable } from "../utils/geography/parse";
import { takeEarlyResponse } from "../utils/publication/early";

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

// The 2024 boundaries as TopoJSON: the GeoJSON's shapes on a 12 m grid with
// the four properties the page reads, a sixth of its size gzipped, drawn the
// same at the map's size and zoom (data_inputs/public_data_review.csv)
export const BOUNDARIES_FILE = "uk_constituencies_2024.topo.json";

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
  { fetchImpl = fetch, base = basePath(), published = publishedFiles(), catalogue } = {},
) {
  const { file, level } = FILES[name];
  // Not in this build: not published, and not requested
  if (published && !published.includes(file)) return failure("unavailable", null);
  try {
    const { text, aliases } = await loadVerifiedFlat(file, catalogue, { fetchImpl, basePath: base });
    const parsed = parseGeographyTable(text, { level });
    // The area run names a package by its alias; the index says which
    // manifest key (the combined run) it stands for
    const table = Object.keys(aliases).length
      ? indexRows(level, parsed.rows.map((row) => (Object.hasOwn(aliases, row.reform) ? { ...row, reform: aliases[row.reform] } : row)))
      : parsed;
    return Object.freeze({ status: "ready", table, features: null, error: null });
  } catch (error) {
    if (error instanceof SnapshotChangedError) return failure("stale", error.message);
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
    const url = `${base}/data/${BOUNDARIES_FILE}`;
    // The head script may have requested it already (publication/early.js)
    const early = fetchImpl === globalThis.fetch ? takeEarlyResponse(url) : null;
    const response = early ? await early.catch(() => fetchImpl(url)) : await fetchImpl(url);
    if (response.status === 404) return failure("unavailable", null);
    if (!response.ok) {
      return failure("error", `${BOUNDARIES_FILE}: HTTP ${response.status}`);
    }
    const body = await response.json();
    // TopoJSON is decoded to features here, with its decoder loaded only now
    let geojson = body;
    if (body?.type === "Topology" && body.objects && typeof body.objects === "object") {
      const { feature } = await import("topojson-client");
      const objects = Object.values(body.objects);
      geojson = objects.length === 1 ? feature(body, objects[0]) : null;
    }
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
  regional: (catalogue) => loadGeographyFile("regional", { catalogue }),
  constituency: (catalogue) => loadGeographyFile("constituency", { catalogue }),
  boundaries: () => loadBoundaries(),
  routing: () => loadAreaRouting(),
};

// One entry per resource and base path: its settled state, and who to tell.
const entries = new Map();

// A failure is kept only while something shows it: the next view to mount
// loads the file again, so one network error does not last the session. A
// missing routing file is tried again too: it may be mid-deploy.
const RETRY = new Set(["error", "stale"]);
const retries = (name, status) => RETRY.has(status) || (name === "routing" && status === "unavailable");

function entryFor(key, name, catalogue) {
  let entry = entries.get(key);
  if (entry && retries(name, entry.state?.status) && entry.listeners.size === 0) {
    entries.delete(key);
    entry = undefined;
  }
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
    load(catalogue).then(settle, () =>
      settle(failure("error", "the file could not be loaded")),
    );
  }
  return entry;
}

const keyFor = (name, catalogue) => `${basePath()}|${name}|${catalogue?.manifest?.snapshotSha256 ?? catalogue?.manifest?.revision ?? "none"}`;

/**
 * Start loading the map's files before any view asks for them (the page's
 * idle prefetch), under the keys the views read, through the same checks.
 */
export function prefetchGeography(catalogue) {
  if (!catalogue?.manifest) return;
  entryFor(keyFor("routing", catalogue), "routing", catalogue);
  const published = publishedFiles();
  for (const name of ["constituency", "regional"]) {
    if (!published || published.includes(FILES[name].file)) entryFor(keyFor(name, catalogue), name, catalogue);
  }
  entryFor(keyFor("boundaries", undefined), "boundaries", undefined);
}

function useCachedResource(name, catalogue) {
  const key = keyFor(name, catalogue);
  const subscribe = useCallback(
    (onChange) => {
      const entry = entryFor(key, name, catalogue);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    [key, name, catalogue],
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
  const catalogue = useMeasureCatalogue();
  const state = useCachedResource(Object.hasOwn(FILES, name) ? name : `unknown:${name}`, catalogue);
  return useMemo(() => {
    if (!catalogue.manifest) return failure("unavailable", "We have published no Budget results yet");
    if (state.status !== "ready") return state;
    const rows = state.table.rows.filter((row) =>
      isCatalogueRowDisplayable(catalogue, row.reform, row.year),
    );
    return { ...state, table: indexRows(state.table.level, rows) };
  }, [state, catalogue]);
}

/** The constituency boundaries: `{status, features, error}`. */
export const useConstituencyBoundaries = () => useCachedResource("boundaries");

/**
 * Whether the release routes results by area: `{status, routing, error}`,
 * fetched once per publication snapshot and shared.
 */
export const useAreaRouting = () => useCachedResource("routing", useMeasureCatalogue());

/** Forget every fetched file (for tests). */
export function resetGeographyCache() {
  entries.clear();
}

export default useGeographyData;

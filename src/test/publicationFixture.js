/**
 * The publication fixture: a real manifest and real artifacts written by the
 * Python publication code (scripts/make_publication_fixture.py). Synthetic
 * test data from a dummy dataset; never real figures.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "publication",
);

/** The bytes of a file under the fixture's data directory. */
export function fixtureBytes(relativePath) {
  return new Uint8Array(readFileSync(join(FIXTURE_ROOT, relativePath)));
}

export function fixtureText(relativePath) {
  return readFileSync(join(FIXTURE_ROOT, relativePath), "utf-8");
}

export function fixtureJson(relativePath) {
  return JSON.parse(fixtureText(relativePath));
}

export const BASE_PATH = "/uk/budgets/autumn-2026";

/**
 * The fixture's two years, read from its manifest rather than written into
 * the tests: one the dataset covers and the one after it, which it does not
 * (the generator keys its values to the installed engine's projection end).
 */
const alphaEntry = fixtureJson("manifest.json").measures.alpha;
const inData = alphaEntry.years.filter(
  (year) => !alphaEntry.unsupported_years.includes(year),
);
if (inData.length !== 1 || alphaEntry.unsupported_years.length !== 1) {
  throw new Error("the fixture needs one year in the data and one beyond it");
}
export const IN_DATA = inData[0];
export const BEYOND_DATA = alphaEntry.unsupported_years[0];

/**
 * A fetch stand-in that serves the fixture under `${BASE_PATH}/data/`.
 *
 * @param {{overrides?: Object<string, Uint8Array|string|number>,
 *   delays?: Object<string, Promise>, ignoreAbort?: boolean}} [options] - `overrides` maps a path
 *   under the data directory to replacement bytes, or to an HTTP status;
 *   `delays` maps a path to a promise to wait for before answering.
 */
export function fixtureFetch({
  overrides = {},
  delays = {},
  ignoreAbort = false,
} = {}) {
  const calls = [];
  const prefix = `${BASE_PATH}/data/`;
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    if (!url.startsWith(prefix)) return new Response(null, { status: 404 });
    const path = decodeURIComponent(url.slice(prefix.length));
    if (delays[path]) await delays[path];
    // ignoreAbort answers even after an abort, as a browser can once a
    // response has arrived, so tests reach the hook's own stale guard.
    if (init.signal?.aborted && !ignoreAbort) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    if (Object.hasOwn(overrides, path)) {
      const override = overrides[path];
      if (typeof override === "number") {
        return new Response(null, { status: override });
      }
      return new Response(override, { status: 200 });
    }
    try {
      return new Response(fixtureBytes(path), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

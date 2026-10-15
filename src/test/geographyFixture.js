/**
 * Synthetic results by area for tests: invented figures, fake constituency
 * codes (Z14...) and fictional seat names, never real data. Only the
 * twelve region codes and names are real.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GEOGRAPHY_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "geography",
);

export const geographyFixture = (name) =>
  readFileSync(join(GEOGRAPHY_FIXTURES, name), "utf-8");

/** The files the page fetches, served from the fixtures by default. */
export const DEFAULT_FILES = Object.freeze({
  "/data/regional.csv": "regional.csv",
  "/data/constituency.csv": "constituency.csv",
  "/data/uk_constituencies_2024.geojson": "constituencies.geojson",
});

/**
 * A fetch stand-in for the geography files.
 *
 * @param {Object<string, string|number|Promise>} [overrides] - Maps a URL
 *   to replacement text, to an HTTP status, or to a promise of either.
 */
export function geographyFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    let answer = Object.hasOwn(overrides, url)
      ? overrides[url]
      : DEFAULT_FILES[url]
        ? geographyFixture(DEFAULT_FILES[url])
        : 404;
    answer = await answer;
    if (typeof answer === "number") return new Response(null, { status: answer });
    return new Response(answer, { status: 200 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

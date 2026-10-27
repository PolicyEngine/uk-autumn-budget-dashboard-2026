/**
 * The releases the page serves: this Budget, and past fiscal events.
 *
 * src/uk_budget_data/releases.json is the allow-list, validated in Python by
 * uk_budget_data/releases.py and read here. The current release keeps
 * `${basePath}/data`, so every 2026 URL is unchanged; a historical release
 * (a fiscal event replayed on today's model and data,
 * docs/historical-releases.md) has its own root,
 * `${basePath}/data/releases/<id>`. A manifest authorises figures only for
 * the release whose root it was fetched from, and only when it names that
 * release's id and date.
 */
import registry from "../../uk_budget_data/releases.json";
import { ManifestError, RELEASES_DIR } from "./manifest";

export { RELEASES_DIR };

export const RELEASES = Object.freeze(
  registry.releases.map((release) => Object.freeze({ ...release })),
);
export const DEFAULT_RELEASE = RELEASES.find(
  (release) => release.id === registry.default && release.kind === "current",
);
if (!DEFAULT_RELEASE) throw new Error("releases.json names no current default release");

export const CURRENT_RELEASE = DEFAULT_RELEASE.id;
export const CURRENT_BUDGET = Object.freeze({ id: CURRENT_RELEASE, date: DEFAULT_RELEASE.date });

/** The historical releases, in registry order. */
export const HISTORICAL_RELEASES = Object.freeze(
  RELEASES.filter((release) => release.kind === "historical"),
);

/** The registered release with this id, or undefined. */
export function findRelease(id) {
  return RELEASES.find((release) => release.id === id);
}

/** The registered historical release with this id, or an error. */
export function getHistoricalRelease(id) {
  const release = HISTORICAL_RELEASES.find((item) => item.id === id);
  if (!release) throw new ManifestError([`${String(id)} is not a past event the dashboard serves`]);
  return release;
}

/** A release's data root, given the site's base path. */
export function dataRoot(basePath, release = DEFAULT_RELEASE) {
  return release.data_root ? `${basePath}/data/${release.data_root}` : `${basePath}/data`;
}

/**
 * The release a loader reads: the one asked for, which must be the
 * catalogue's when the catalogue was loaded already; else the catalogue's,
 * whose manifest was checked against the release it was fetched for; else
 * this Budget.
 */
export function releaseFor(manifest, release) {
  const own = manifest ? findRelease(manifest.release) : undefined;
  if (release && manifest && own !== release) {
    throw new ManifestError([`the loaded manifest is not for ${release.name}`]);
  }
  return release ?? own ?? DEFAULT_RELEASE;
}

/** Identity must be explicit: another release's or an unidentified snapshot never authorises figures. */
export function assertRelease(manifest, release = DEFAULT_RELEASE) {
  if (manifest?.release !== release.id || manifest?.budget?.id !== release.id || manifest?.budget?.date !== release.date) {
    throw new ManifestError([
      release === DEFAULT_RELEASE
        ? "release or Budget identity is not the 2026 Budget"
        : `release or Budget identity is not ${release.name}`,
    ]);
  }
  return manifest;
}

export function assertCurrentRelease(manifest) {
  return assertRelease(manifest, DEFAULT_RELEASE);
}

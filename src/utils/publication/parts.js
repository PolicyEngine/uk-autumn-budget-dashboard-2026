/**
 * The verified parts of the page's figures, apart from the page's React
 * code (measureCatalogue.jsx), so the build's server code can load them too
 * (app/publicationBoot.ts). loadDashboard.js builds the figures from them.
 */

import { CATALOGUE_TABLES, loadManifest, loadPublication } from "./load";
import { isDisplayable } from "./manifest";

/**
 * The verified parts loadDashboard builds the page's figures from: the
 * manifest (with its digest), and each artifact's verified tables and the
 * ones that failed. Plain data, so the build can verify a publication
 * once and hand the result to the page (app/publicationBoot.ts).
 */
export async function loadDashboardParts(basePath = "", { fetchImpl = fetch, signal } = {}) {
  const manifest = await loadManifest(basePath, { fetchImpl, signal });
  if (!manifest) return { status: "no-manifest" };
  // The package is every displayable measure: a held or not-computable
  // measure is shown as unavailable, so the combined run that describes the
  // page's figures is the one of the displayable measures.
  const packageIds = Object.keys(manifest.measures).filter((id) => isDisplayable(manifest.measures[id]));
  const publication = await loadPublication(basePath, packageIds, { fetchImpl, signal, manifest, tables: CATALOGUE_TABLES });
  return { status: "ready", manifest, snapshotSha256: manifest.snapshotSha256, tablesByKey: publication.tablesByKey, failures: publication.failures };
}

// JSON with every object's keys sorted: two loads list an artifact's tables
// in the order they arrived
function canonicalJson(value) {
  return JSON.stringify(value, (key, member) =>
    member !== null && typeof member === "object" && !Array.isArray(member)
      ? Object.fromEntries(Object.keys(member).sort().map((name) => [name, member[name]]))
      : member,
  );
}

/**
 * True when two loadDashboardParts results carry the same publication: the
 * same manifest bytes (its digest), the same verified tables and the same
 * failures.
 */
export function sameParts(left, right) {
  if (left?.status !== "ready" || right?.status !== "ready") return false;
  if (left.snapshotSha256 !== right.snapshotSha256) return false;
  return canonicalJson({ tables: left.tablesByKey, failures: left.failures }) ===
    canonicalJson({ tables: right.tablesByKey, failures: right.failures });
}


import { jcsSha256, sha256Hex } from "./digest";
import { loadManifest } from "./load";
import { assertCurrentRelease } from "./release";

export const RELEASE_INDEX_FILE = "release-index.json";
export const RELEASE_INDEX_SCHEMA = "uk-budget-release-index/v1";
// As FLAT_VIEW_FILES in uk_budget_data/publication/release_index.py: the
// flat files a view may read, results by area only. Every other figure comes
// from a receipt-verified artifact. The OBR comparison's file is never bound
// (it holds the November 2025 costings), so that view stays unavailable.
export const FLAT_VIEW_FILES = Object.freeze(["constituency.csv", "regional.csv"]);
const DIGEST = /^[a-f0-9]{64}$/;

/** The manifest has changed since the page loaded: reload to see the new results. */
export class SnapshotChangedError extends Error {
  constructor() {
    super("Newer results have been published since this page loaded");
    this.name = "SnapshotChangedError";
  }
}
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Check a release index against the manifest the page loaded: the same
 * release, Budget, revision and manifest bytes, and the manifest's own file
 * digests. Returns the bound files and the aliases their tables use for
 * manifest keys (a package alias for its combined run).
 *
 * @throws {Error} on any mismatch
 */
export async function verifyReleaseIndex(index, manifest) {
  assertCurrentRelease(manifest);
  if (index?.schema !== RELEASE_INDEX_SCHEMA || index.release !== manifest.release || index.budget?.id !== manifest.budget.id || index.budget?.date !== manifest.budget.date || index.manifest_revision !== manifest.revision || !DIGEST.test(manifest.snapshotSha256 ?? "") || index.manifest_sha256 !== manifest.snapshotSha256) {
    throw new Error("The release index does not match the current manifest snapshot");
  }
  const files = index.files;
  if (!isMap(files) || !Object.keys(files).length || Object.entries(files).some(([file, digest]) => !FLAT_VIEW_FILES.includes(file) || !DIGEST.test(digest)) || !manifest.flat_files || await jcsSha256(files) !== await jcsSha256(manifest.flat_files)) {
    throw new Error("The release index files are not bound to the manifest");
  }
  const isKey = (key) => typeof key === "string" && (Object.hasOwn(manifest.measures, key) || Object.hasOwn(manifest.combined, key));
  const aliases = index.aliases;
  if (!isMap(aliases) || Object.entries(aliases).some(([alias, key]) => isKey(alias) || !isKey(key))) {
    throw new Error("The release index aliases do not name manifest keys");
  }
  return { files, aliases: Object.freeze(Object.assign(Object.create(null), aliases)) };
}

/**
 * One flat view file, bound to the loaded manifest snapshot by the release
 * index and checked byte for byte (Web Crypto). Any mismatch throws, so the
 * view is unavailable rather than showing another snapshot's figures.
 *
 * @returns {Promise<{text: string, aliases: Object<string, string>}>}
 */
export async function loadVerifiedFlat(fileName, catalogue, { basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch, signal } = {}) {
  if (!FLAT_VIEW_FILES.includes(fileName)) throw new Error(`${fileName} is not a flat view file`);
  // Standalone loaders also require a current snapshot; a missing provider
  // cannot restore the historical CSV-only route.
  const manifest = catalogue?.manifest ?? await loadManifest(basePath, { fetchImpl, signal });
  if (!manifest) throw new Error("No Budget results are published yet");
  const indexResponse = await fetchImpl(`${basePath}/data/${RELEASE_INDEX_FILE}`, { signal, cache: "no-cache" });
  if (!indexResponse.ok) throw new Error("The release index is unavailable");
  let verified;
  try {
    verified = await verifyReleaseIndex(await indexResponse.json(), manifest);
  } catch (error) {
    // A page left open across a deploy: say so, rather than "unavailable"
    const live = await loadManifest(basePath, { fetchImpl, signal }).catch(() => null);
    if (live && live.snapshotSha256 !== manifest.snapshotSha256) throw new SnapshotChangedError();
    throw error;
  }
  const { files, aliases } = verified;
  if (!Object.hasOwn(files, fileName)) throw new Error(`${fileName} is unavailable in this snapshot`);
  const response = await fetchImpl(`${basePath}/data/${fileName}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`${fileName} is unavailable`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== files[fileName]) throw new Error(`${fileName} does not match the publication snapshot`);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), aliases };
}

/** The text of one flat view file, verified as loadVerifiedFlat does. */
export async function loadVerifiedFlatCsv(fileName, catalogue, options) {
  return (await loadVerifiedFlat(fileName, catalogue, options)).text;
}

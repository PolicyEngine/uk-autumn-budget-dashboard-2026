import { artifactSha256, jcsSha256, sha256Hex } from "./digest";
import { loadManifest } from "./load";
import { assertRelease, dataRoot, DEFAULT_RELEASE, releaseFor } from "./release";
import { parseCsv } from "./csv";
import { AREA_PROVENANCE_FILE, assertAreaProvenance, assertAreaReceipt, assertAreaRows } from "./area";

export const RELEASE_INDEX_FILE = "release-index.json";
export const RELEASE_INDEX_SCHEMA = "uk-budget-release-index/v1";
// As FLAT_VIEW_FILES in uk_budget_data/publication/release_index.py: the
// flat files a view may read, results by area only. Every other figure comes
// from a receipt-verified artifact. The OBR comparison's file is never bound,
// so that view stays unavailable, even once the OBR's columns are filled; it
// needs a verified route of its own.
export const FLAT_VIEW_FILES = Object.freeze(["constituency.csv", "regional.csv"]);
// As HISTORICAL_FLAT_VIEW_FILES there: a past event's flat views, its
// coverage, the measures it does not model and its own OBR comparison.
export const HISTORICAL_FLAT_VIEW_FILES = Object.freeze(["coverage.csv", "not_modelled.csv", "obr_comparison.csv"]);
const DIGEST = /^[a-f0-9]{64}$/;

/** The flat files a release's page may read. */
export const viewFiles = (release = DEFAULT_RELEASE) =>
  release.kind === "historical" ? HISTORICAL_FLAT_VIEW_FILES : FLAT_VIEW_FILES;

/** The manifest has changed since the page loaded: reload to see the new results. */
export class SnapshotChangedError extends Error {
  constructor() {
    super("Newer results have been published since this page loaded");
    this.name = "SnapshotChangedError";
  }
}
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Check a release index against the manifest the page loaded for `release`:
 * the same release, Budget, revision and manifest bytes, and the manifest's
 * own file digests, for files that release's views read. Returns the bound
 * files and the aliases their tables use for manifest keys (a package alias
 * for its combined run).
 *
 * @throws {Error} on any mismatch
 */
export async function verifyReleaseIndex(index, manifest, release = DEFAULT_RELEASE) {
  assertRelease(manifest, release);
  if (index?.schema !== RELEASE_INDEX_SCHEMA || index.release !== manifest.release || index.budget?.id !== manifest.budget.id || index.budget?.date !== manifest.budget.date || index.manifest_revision !== manifest.revision || !DIGEST.test(manifest.snapshotSha256 ?? "") || index.manifest_sha256 !== manifest.snapshotSha256) {
    throw new Error("The release index does not match the current manifest snapshot");
  }
  const files = index.files;
  const allowed = viewFiles(release);
  if (!isMap(files) || !Object.keys(files).length || Object.entries(files).some(([file, digest]) => !allowed.includes(file) || !DIGEST.test(digest)) || !manifest.flat_files || await jcsSha256(files) !== await jcsSha256(manifest.flat_files)) {
    throw new Error("The release index files are not bound to the manifest");
  }
  const isKey = (key) => typeof key === "string" && (Object.hasOwn(manifest.measures, key) || Object.hasOwn(manifest.combined, key));
  const aliases = index.aliases;
  if (!isMap(aliases) || Object.entries(aliases).some(([alias, key]) => isKey(alias) || !isKey(key))) {
    throw new Error("The release index aliases do not name manifest keys");
  }
  // The aliases are part of the approved snapshot, as the file digests are
  if (await jcsSha256(aliases) !== await jcsSha256(manifest.flat_aliases ?? {})) {
    throw new Error("The release index aliases are not the manifest's");
  }
  const bound = Object.freeze(Object.assign(Object.create(null), aliases));
  if (release.kind === "historical") {
    // A past event has no results by area, so nothing binds area provenance
    if (index.flat_provenance_sha256 !== undefined || manifest.flat_provenance_sha256 !== undefined) {
      throw new Error("A past event binds no area provenance");
    }
    return { files, aliases: bound, provenanceDigest: null };
  }
  if (!DIGEST.test(index.flat_provenance_sha256 ?? "") || index.flat_provenance_sha256 !== manifest.flat_provenance_sha256) {
    throw new Error("Area provenance is not bound to the manifest snapshot");
  }
  return { files, aliases: bound, provenanceDigest: index.flat_provenance_sha256 };
}

/**
 * One flat view file of a release, bound to its manifest snapshot by the
 * release index and checked byte for byte (Web Crypto). The release is the
 * one asked for, else the catalogue's (whose manifest was checked against
 * the release it was fetched for), else this Budget; the index and file are
 * read from that release's own data root. Any mismatch throws, so the view
 * is unavailable rather than showing another snapshot's figures.
 *
 * @returns {Promise<{text: string, aliases: Object<string, string>}>}
 */
export async function loadVerifiedFlat(fileName, catalogue, { basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch, signal, release } = {}) {
  release = releaseFor(catalogue?.manifest, release);
  if (!viewFiles(release).includes(fileName)) throw new Error(`${fileName} is not a flat view file`);
  // Standalone loaders also require a current snapshot; a missing provider
  // cannot restore the historical CSV-only route.
  const manifest = catalogue?.manifest ?? await loadManifest(basePath, { fetchImpl, signal, release });
  if (!manifest) throw new Error("No Budget results are published yet");
  const root = dataRoot(basePath, release);
  const indexResponse = await fetchImpl(`${root}/${RELEASE_INDEX_FILE}`, { signal, cache: "no-cache" });
  if (!indexResponse.ok) throw new Error("The release index is unavailable");
  let verified;
  try {
    verified = await verifyReleaseIndex(await indexResponse.json(), manifest, release);
  } catch (error) {
    // A page left open across a deploy: say so, rather than "unavailable"
    const live = await loadManifest(basePath, { fetchImpl, signal, release }).catch(() => null);
    if (live && live.snapshotSha256 !== manifest.snapshotSha256) throw new SnapshotChangedError();
    throw error;
  }
  const { files, aliases, provenanceDigest } = verified;
  // This Budget's views are results by area, each row bound to its approved
  // calculation; a past event's (viewFiles) are not, and bind no provenance
  const byArea = release.kind !== "historical";
  let provenance = null;
  if (byArea) {
    const provenanceResponse = await fetchImpl(`${root}/${AREA_PROVENANCE_FILE}`, { signal, cache: "no-cache" });
    if (!provenanceResponse.ok) throw new Error("Area provenance is unavailable");
    const provenanceBytes = await provenanceResponse.arrayBuffer();
    if (await sha256Hex(provenanceBytes) !== provenanceDigest) throw new Error("Area provenance differs from the publication snapshot");
    provenance = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(provenanceBytes));
    assertAreaProvenance(provenance, manifest, files, aliases);
    await Promise.all(Object.values(provenance.reforms).map(async (record) => {
      const receiptResponse = await fetchImpl(`${root}/${record.artifact}/receipt.json`, { signal });
      if (!receiptResponse.ok) throw new Error("Approved area receipt is unavailable");
      const receipt = await receiptResponse.json();
      if (await artifactSha256(receipt) !== record.artifact_sha256) throw new Error("Area provenance receipt differs from the approved artifact");
      assertAreaReceipt(record, receipt);
    }));
  }
  if (!Object.hasOwn(files, fileName)) throw new Error(`${fileName} is unavailable in this snapshot`);
  const response = await fetchImpl(`${root}/${fileName}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`${fileName} is unavailable`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== files[fileName]) throw new Error(`${fileName} does not match the publication snapshot`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (byArea) assertAreaRows(parseCsv(text), provenance);
  return { text, aliases };
}

/** The text of one flat view file, verified as loadVerifiedFlat does. */
export async function loadVerifiedFlatCsv(fileName, catalogue, options) {
  return (await loadVerifiedFlat(fileName, catalogue, options)).text;
}

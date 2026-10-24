import { jcsSha256, sha256Hex } from "./digest";
import { loadManifest } from "./load";
import { assertCurrentRelease } from "./release";

export const RELEASE_INDEX_FILE = "release-index.json";
export const RELEASE_INDEX_SCHEMA = "uk-budget-release-index/v1";
const DIGEST = /^[a-f0-9]{64}$/;

/** Flat-only views must share the exact manifest and reviewed file digests. */
export async function verifyReleaseIndex(index, manifest) {
  assertCurrentRelease(manifest);
  if (index?.schema !== RELEASE_INDEX_SCHEMA || index.release !== manifest.release || index.budget?.id !== manifest.budget.id || index.budget?.date !== manifest.budget.date || index.manifest_revision !== manifest.revision || !DIGEST.test(manifest.snapshotSha256 ?? "") || index.manifest_sha256 !== manifest.snapshotSha256) {
    throw new Error("The release index does not match the current manifest snapshot");
  }
  const files = index.files;
  if (!files || Array.isArray(files) || typeof files !== "object" || !Object.keys(files).length || Object.entries(files).some(([file, digest]) => !/^[a-z][a-z0-9_]*\.csv$/.test(file) || !DIGEST.test(digest)) || !manifest.flat_files || await jcsSha256(files) !== await jcsSha256(manifest.flat_files)) {
    throw new Error("The release index files are not bound to the manifest");
  }
  return files;
}

export async function loadVerifiedFlatCsv(fileName, catalogue, { basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch, signal } = {}) {
  // Standalone loaders also require a current snapshot; a missing provider
  // cannot restore the historical CSV-only route.
  const manifest = catalogue?.manifest ?? await loadManifest(basePath, { fetchImpl, signal });
  if (!manifest) throw new Error("No Budget results are published yet");
  const indexResponse = await fetchImpl(`${basePath}/data/${RELEASE_INDEX_FILE}`, { signal, cache: "no-cache" });
  if (!indexResponse.ok) throw new Error("The release index is unavailable");
  const files = await verifyReleaseIndex(await indexResponse.json(), manifest);
  if (!Object.hasOwn(files, fileName)) throw new Error(`${fileName} is unavailable in this snapshot`);
  const response = await fetchImpl(`${basePath}/data/${fileName}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`${fileName} is unavailable`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== files[fileName]) throw new Error(`${fileName} does not match the publication snapshot`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Fetch the manifest and the artifacts a selection needs, verifying each.
 *
 * The manifest is always fetched fresh, because a correction changes it. An
 * artifact directory never changes once written, so its files may be cached.
 * An artifact that fails any check is left out and listed in `failures`: it
 * is unavailable, never partly shown.
 */

import { parseTable, tableForFile, TABLES } from "./csv";
import { verifyFile, verifyReceiptFiles } from "./digest";
import {
  isDisplayable,
  MANIFEST_FILE,
  parseManifest,
  RECEIPT_FILE,
} from "./manifest";
import { combinedEntryFor, uniqueIds } from "./select";

/** The tables the national charts and headline statistics read. */
export const DEFAULT_TABLES = [
  "budgetary_impact",
  "distributional_impact",
  "winners_losers",
  "metrics",
  "household_scatter_binned",
];

function isAbort(error) {
  return error?.name === "AbortError";
}

async function fetchOk(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const error = new Error(`${url}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

/**
 * Fetch and validate the manifest.
 *
 * @returns {Promise<Object|null>} The manifest, or null when none is
 *   published yet (HTTP 404).
 */
export async function loadManifest(
  basePath,
  { fetchImpl = fetch, signal } = {},
) {
  const url = `${basePath}/data/${MANIFEST_FILE}`;
  const response = await fetchImpl(url, { signal, cache: "no-cache" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return parseManifest(await response.json());
}

/**
 * Fetch one entry's artifact and return its verified, typed tables.
 *
 * @throws {Error} naming the first check that failed.
 */
export async function loadArtifact(
  basePath,
  key,
  entry,
  { fetchImpl = fetch, signal, tables = DEFAULT_TABLES } = {},
) {
  const base = `${basePath}/data/${entry.artifact}`;
  const receipt = await (
    await fetchOk(fetchImpl, `${base}/${RECEIPT_FILE}`, { signal })
  ).json();
  if (receipt?.dashboard?.key !== key) {
    throw new Error("the receipt is for a different entry");
  }
  if (!(await verifyReceiptFiles(receipt, entry))) {
    throw new Error("the receipt's files are not the ones the manifest names");
  }
  const listed = Object.keys(receipt.dashboard.files);
  const loaded = {};
  await Promise.all(
    tables.map(async (table) => {
      const fileName = TABLES[table].file;
      if (!listed.includes(fileName)) {
        if (TABLES[table].required) {
          throw new Error(`the artifact has no ${fileName}`);
        }
        return;
      }
      const response = await fetchOk(fetchImpl, `${base}/${fileName}`, {
        signal,
      });
      const bytes = await response.arrayBuffer();
      if (!(await verifyFile(fileName, bytes, receipt))) {
        throw new Error(`${fileName} does not match its receipt`);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      loaded[tableForFile(fileName)] = parseTable(table, text);
    }),
  );
  return loaded;
}

/**
 * Load everything the page may show for a selection.
 *
 * @returns {Promise<{status: "ready"|"no-manifest", manifest: Object|null,
 *   tablesByKey: Object, failures: Object, selection: Array<string>}>}
 */
export async function loadPublication(basePath, selectedIds, options = {}) {
  const selection = uniqueIds(selectedIds);
  const manifest = await loadManifest(basePath, options);
  if (manifest === null) {
    return {
      status: "no-manifest",
      manifest: null,
      tablesByKey: {},
      failures: {},
      selection,
    };
  }
  const wanted = new Map();
  for (const id of selection) {
    const entry = Object.hasOwn(manifest.measures, id)
      ? manifest.measures[id]
      : undefined;
    if (isDisplayable(entry)) wanted.set(id, entry);
  }
  const combined = combinedEntryFor(manifest, selection);
  if (combined) wanted.set(combined.key, combined.entry);

  const tablesByKey = {};
  const failures = {};
  await Promise.all(
    [...wanted].map(async ([key, entry]) => {
      try {
        tablesByKey[key] = await loadArtifact(basePath, key, entry, options);
      } catch (error) {
        if (isAbort(error)) throw error;
        failures[key] = error.message;
      }
    }),
  );
  return { status: "ready", manifest, tablesByKey, failures, selection };
}

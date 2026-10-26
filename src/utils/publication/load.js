/**
 * Fetch the manifest and the artifacts a selection needs, verifying each.
 *
 * The manifest is always fetched fresh, because a correction changes it. An
 * artifact directory never changes once written, so its files may be cached.
 * An artifact that fails any check is left out and listed in `failures`: it
 * is unavailable, never partly shown.
 */

import { cachedFile, cachedReceipt, forgetReceipt, rememberFile, rememberReceipt } from "./cache";
import { parseTable, tableForFile, TABLES, withPovertyInequality } from "./csv";
import { receiptProblems, sha256Hex, verifyReceiptFiles } from "./digest";
import { manifestUrl, takeEarlyManifest, takeEarlyResponse } from "./early";
import { assertCurrentRelease } from "./release";
import {
  isDisplayable,
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
  // Optional: the poverty and inequality measures, merged into metrics' rows
  // (withPovertyInequality) when the artifact has them
  "poverty_inequality",
  "household_scatter_binned",
];

/**
 * The tables the page waits for before its first chart: every view's
 * headline figures. The household scatter (about three quarters of the
 * bytes) and the age table load when a view needs them, or when the page is
 * idle, through the same checks.
 */
export const CATALOGUE_TABLES = DEFAULT_TABLES.filter(
  (table) => table !== "household_scatter_binned",
);

// Every artifact must list these files, whichever tables a load reads, as
// it had to when every load read all of them: an artifact without one is
// refused whole, never shown in part.
const LISTED_TABLES = DEFAULT_TABLES;

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
  const url = manifestUrl(basePath);
  // The head's script started this request before the page's code loaded
  // (early.js); only the page's own fetch adopts it, once
  const early = fetchImpl === globalThis.fetch ? takeEarlyManifest(url) : null;
  let response = early ? await early.catch(() => null) : null;
  if (!response) response = await fetchImpl(url, { signal, cache: "no-cache" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const manifest = assertCurrentRelease(parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))));
  Object.defineProperty(manifest, "snapshotSha256", { value: await sha256Hex(bytes) });
  return manifest;
}

/**
 * The package versions a verified receipt records: its wrapper, model and
 * core, by package name, as the household API reports its own.
 */
export function receiptEngine(receipt) {
  const execution = receipt?.execution_receipt ?? {};
  const engine = {};
  for (const part of ["wrapper", "model", "core"]) {
    const { name, version } = execution[part] ?? {};
    if (typeof name === "string" && typeof version === "string") engine[name] = version;
  }
  return engine;
}

const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

// Each verified file's parsed table, by digest and table: a file is parsed
// once per page, whichever view asks for it
const parsed = new Map();

function parsedTable(table, digest, bytes) {
  const key = `${digest}:${table}`;
  if (!parsed.has(key)) parsed.set(key, parseTable(table, decode(bytes)));
  return parsed.get(key);
}

/** Forget parsed tables (tests). */
export function resetParsedTables() {
  parsed.clear();
}

async function fetchBytes(fetchImpl, url, signal) {
  const response = await fetchOk(fetchImpl, url, { signal });
  return new Uint8Array(await response.arrayBuffer());
}

// The head script may already have requested this receipt or file
// (early.js); only the page's own fetch adopts it, a failed early request is
// retried, and the bytes are checked as any others
async function fetchEarly(fetchImpl, url, signal) {
  const early = fetchImpl === globalThis.fetch ? takeEarlyResponse(url) : null;
  const response = early ? await early.catch(() => null) : null;
  if (response?.ok) return new Uint8Array(await response.arrayBuffer());
  return fetchBytes(fetchImpl, url, signal);
}

/**
 * Fetch one entry's artifact and return its verified, typed tables, with
 * the package versions its receipt records as `engine`.
 *
 * No table is requested until its receipt has passed every check. Bytes
 * already verified on this page or a previous visit are read from the
 * cache (cache.js) and checked again, so a repeat load makes no request.
 *
 * @throws {Error} naming the first check that failed.
 */
export async function loadArtifact(
  basePath,
  key,
  entry,
  { fetchImpl = fetch, signal, tables = DEFAULT_TABLES } = {},
) {
  if (!isDisplayable(entry)) {
    throw new Error(`${key} is ${entry?.status}: its figures are not shown`);
  }
  const base = `${basePath}/data/${entry.artifact}`;
  const keptReceipt = await cachedReceipt(entry.artifact_sha256, fetchImpl);
  const receiptBytes = keptReceipt ?? await fetchEarly(fetchImpl, `${base}/${RECEIPT_FILE}`, signal);
  let receipt;
  try {
    receipt = JSON.parse(decode(receiptBytes));
  } catch {
    if (keptReceipt) forgetReceipt(entry.artifact_sha256, fetchImpl);
    throw new Error("the receipt is not valid JSON");
  }
  const problems = await receiptProblems(receipt, key, entry);
  if (problems.length > 0) {
    if (keptReceipt) forgetReceipt(entry.artifact_sha256, fetchImpl);
    throw new Error(problems.join("; "));
  }
  if (!(await verifyReceiptFiles(receipt, entry))) {
    if (keptReceipt) forgetReceipt(entry.artifact_sha256, fetchImpl);
    throw new Error("the receipt's files are not the ones the manifest names");
  }
  const files = receipt.dashboard.files;
  const listed = Object.keys(files);
  for (const table of LISTED_TABLES) {
    if (TABLES[table].required && !listed.includes(TABLES[table].file)) {
      throw new Error(`the artifact has no ${TABLES[table].file}`);
    }
  }
  if (!keptReceipt) rememberReceipt(entry.artifact_sha256, receiptBytes, fetchImpl);
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
      const digest = files[fileName];
      let bytes = await cachedFile(digest, fetchImpl);
      if (!bytes) {
        // The head script may have requested it while the page loaded
        // (early.js); it is used only if it hashes to the receipt's digest
        bytes = await fetchEarly(fetchImpl, `${base}/${fileName}`, signal);
        if ((await sha256Hex(bytes)) !== digest) {
          throw new Error(`${fileName} does not match its receipt`);
        }
        rememberFile(digest, bytes, fetchImpl);
      }
      loaded[tableForFile(fileName)] = parsedTable(table, digest, bytes);
    }),
  );
  // The charts choose between the poverty and inequality measures in
  // metrics' rows, as in the flat metrics.csv
  if (loaded.metrics && loaded.poverty_inequality) {
    loaded.metrics = withPovertyInequality(loaded.metrics, loaded.poverty_inequality);
  }
  loaded.engine = receiptEngine(receipt);
  return loaded;
}

/**
 * The members of a combined run that did not load. A combined run's figures
 * stand only with its members': if any member's artifact failed
 * verification (its receipt records a data limit, say), the combined run is
 * not shown either, whatever the manifest says. Membership is by own key,
 * so a member id such as `constructor` is never found on a prototype.
 */
export function unverifiedMembers(memberIds, tablesByKey) {
  return memberIds.filter((id) => !Object.hasOwn(tablesByKey, id));
}

/**
 * Load everything the page may show for a selection. Its tables and
 * failures are keyed by measure id with no prototype, so no id reads an
 * inherited property.
 *
 * @returns {Promise<{status: "ready"|"no-manifest", manifest: Object|null,
 *   tablesByKey: Object, failures: Object, selection: Array<string>}>}
 */
export async function loadPublication(basePath, selectedIds, options = {}) {
  const selection = uniqueIds(selectedIds);
  const manifest = options.manifest ?? await loadManifest(basePath, options);
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

  const tablesByKey = Object.create(null);
  const failures = Object.create(null);
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
  if (
    combined &&
    !combined.single &&
    Object.hasOwn(tablesByKey, combined.key)
  ) {
    const failed = unverifiedMembers(combined.entry.measures, tablesByKey);
    if (failed.length > 0) {
      delete tablesByKey[combined.key];
      failures[combined.key] =
        `its member ${failed.join(", ")} did not verify: ` +
        failed.map((id) => failures[id] ?? "not loaded").join("; ");
    }
  }
  return { status: "ready", manifest, tablesByKey, failures, selection };
}

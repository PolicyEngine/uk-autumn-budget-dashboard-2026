/**
 * Fetch the manifest and the artifacts a selection needs, verifying each.
 *
 * The manifest is always fetched fresh, because a correction changes it. An
 * artifact directory never changes once written, so its files may be cached.
 * An artifact that fails any check is left out and listed in `failures`: it
 * is unavailable, never partly shown.
 */

import { parseTable, tableForFile, TABLES, withPovertyInequality } from "./csv";
import { receiptDefinition } from "./definitions";
import { receiptProblems, sha256Hex, verifyFile, verifyReceiptFiles } from "./digest";
import { assertCurrentRelease } from "./release";
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
  // Optional: the poverty and inequality measures, merged into metrics' rows
  // (withPovertyInequality) when the artifact has them
  "poverty_inequality",
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

/**
 * Fetch one entry's artifact and return its verified, typed tables, with
 * the package versions its receipt records as `engine` and the definition
 * it approved (its commit and reform identities) as `definition`.
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
  const receipt = await (
    await fetchOk(fetchImpl, `${base}/${RECEIPT_FILE}`, { signal })
  ).json();
  const problems = await receiptProblems(receipt, key, entry);
  if (problems.length > 0) throw new Error(problems.join("; "));
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
  // The charts choose between the poverty and inequality measures in
  // metrics' rows, as in the flat metrics.csv
  if (loaded.metrics && loaded.poverty_inequality) {
    loaded.metrics = withPovertyInequality(loaded.metrics, loaded.poverty_inequality);
  }
  loaded.engine = receiptEngine(receipt);
  loaded.definition = receiptDefinition(receipt);
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

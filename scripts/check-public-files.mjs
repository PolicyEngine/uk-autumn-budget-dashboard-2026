#!/usr/bin/env node
// Fail the build if a file under public/ may not be published.
//
// While sign-off is on (uk_budget_data/sign_off.py, carried by the page's
// contract), every file a deploy would serve must be listed in
// data_inputs/public_data_review.csv with the sha256 of the bytes a person
// reviewed, tables from the disclosure layer included; a pending entry
// passes only until its expiry date. A file reviewed as a disclosure table
// must carry the layer's public columns, and a CSV that carries them must be
// reviewed as one. Sign-off is off from Budget day (28 October 2026). The
// review list is then read only for the area-code guard's exemption, as in
// scripts/check_public_data.py: a file may carry more than 20 constituency,
// local-authority or small-area codes only as reference geography whose
// exact bytes a reference_geography row (or a pending row, until its expiry
// date) names, or as a disclosure-layer table the release index binds. The
// build can't run the layer's validate_public, so that binding, to what the
// area run wrote and validated, stands in for it. A CSV with the layer's
// columns may carry no column the layer does not publish, and a file under
// public/data/artifacts/ must be one the page lists: a listed manifest
// entry's receipt, or a file that receipt binds. Either way, no public file may carry
// record-level identifiers, and no artifact whose receipt records cells
// under the floor of survey households left in its tables (a
// whole-measure-thin run written with a warning; the gate never stages it).
// The page's area routing status takes no review entry, and must be one of
// the few texts uk_budget_data.area_routing writes; the area run's
// provenance must keep to its closed schema.
//
// scripts/check_public_data.py runs the full check in CI, including the
// layer's validate_public. This smaller check runs in the build, so a deploy
// that skips CI cannot ship a file it refuses. It walks the files on disk,
// which is what a deploy serves, and prints paths and rule names only.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";
import { AREA_PROVENANCE_FILE, areaReceiptTarget, assertAreaProvenance, assertAreaProvenanceDocument, assertAreaReceipt, assertAreaRows } from "../src/utils/publication/area.js";
import { withholdingProblems } from "../src/utils/publication/withholding.js";

const RECORD_LEVEL = /\b(?:household|benunit|person)_(?:id|weight)\b/;
// As scripts/check_public_data.py: GSS codes of Westminster constituencies,
// local authorities, wards and small areas, and how many a file may carry.
const AREA_CODE = /\b(?:E14|W07|S14|N05|E06|E07|E08|E09|W06|S12|N09|E05|W05|S13|N08|E02|W02|S02|E01|W01|S01|E00|W00|S00|N00|N20|N21)\d{6}\b/g;
const MAX_AREA_CODES = 20;
const MAX_PENDING_DAYS = 14;
// As LISTED in uk_budget_data/publication/manifest.py: the statuses the page
// lists (tests/test_check_public_files_build.py checks the two are equal).
export const LISTED_STATUSES = ["approved", "provisional", "not_computable"];
const CURRENT_RELEASE = "uk-autumn-budget-2026";
const CURRENT_BUDGET = { id: CURRENT_RELEASE, date: "2026-10-28" };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dropNulls = (value) => Array.isArray(value) ? value.map(dropNulls) :
  value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, member]) => member !== null).map(([key, member]) => [key, dropNulls(member)])) : value;
const artifactDigest = (receipt) => digest(canonicalize(dropNulls({
  schema: receipt.schema, execution_receipt: receipt.execution_receipt,
  dashboard: Object.fromEntries(Object.entries(receipt.dashboard ?? {}).filter(([field]) => !["generated_at", "generator_argv"].includes(field))),
})));
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameMap = (left, right) => isMap(left) && isMap(right) &&
  Object.keys(left).sort().join() === Object.keys(right).sort().join() &&
  Object.entries(left).every(([key, value]) => right[key] === value);

// As FLAT_VIEW_FILES in uk_budget_data/publication/release_index.py: the
// flat files a view reads directly (results by area). Every other figure
// comes from an artifact.
export const FLAT_VIEW_FILES = ["constituency.csv", "regional.csv"];

const isCurrentManifest = (manifest) =>
  manifest?.schema === "uk-budget-dashboard/publication-manifest/v1" &&
  manifest.release === CURRENT_RELEASE && sameMap(manifest.budget, CURRENT_BUDGET);

/**
 * A manifest names this Budget, and the flat files a view reads are bound
 * to exactly that manifest's bytes and revision (release-index.json).
 */
export function checkReleaseIndex(root) {
  const directory = join(root, "public", "data");
  const manifestPath = join(directory, "manifest.json");
  const indexPath = join(directory, "release-index.json");
  if (!existsSync(indexPath) && !existsSync(manifestPath)) return [];
  const problems = [];
  try {
    const bytes = readFileSync(manifestPath);
    const manifest = JSON.parse(bytes);
    if (!existsSync(indexPath) && !Object.keys(manifest.flat_files ?? {}).length) {
      return isCurrentManifest(manifest) ? [] : ["manifest is not explicitly for the current 2026 Budget release"];
    }
    const index = JSON.parse(readFileSync(indexPath));
    if (lstatSync(manifestPath).isSymbolicLink() || lstatSync(indexPath).isSymbolicLink()) {
      problems.push("release index: symbolic link");
    }
    if (!isCurrentManifest(manifest)) {
      problems.push("release index: manifest is not explicitly for the current 2026 Budget release");
    }
    if (index.schema !== "uk-budget-release-index/v1") problems.push("release index: unknown schema");
    if (index.release !== manifest.release || !sameMap(index.budget, manifest.budget)) {
      problems.push("release index: release or Budget identity differs");
    }
    if (!Number.isInteger(manifest.revision) || manifest.revision < 1 ||
        index.manifest_revision !== manifest.revision) {
      problems.push("release index: manifest revision differs");
    }
    if (index.manifest_sha256 !== digest(bytes)) problems.push("release index: manifest bytes differ");
    const keys = new Set([...Object.keys(manifest.measures ?? {}), ...Object.keys(manifest.combined ?? {})]);
    if (!isMap(index.aliases) || Object.entries(index.aliases).some(([alias, key]) => keys.has(alias) || !keys.has(key))) {
      problems.push("release index: aliases must name manifest keys, and only them");
    }
    if (!sameMap(index.aliases ?? {}, manifest.flat_aliases ?? {})) {
      problems.push("release index: aliases differ from the manifest's");
    }
    const files = index.files;
    if (!isMap(files) || !Object.keys(files).length) return [...problems, "release index: no flat CSV digests"];
    if (!sameMap(files, manifest.flat_files)) problems.push("release index: file map differs from manifest");
    let verifiedProvenance = null;
    const provenancePath = join(directory, AREA_PROVENANCE_FILE);
    if (!/^[0-9a-f]{64}$/.test(index.flat_provenance_sha256 ?? "") ||
        index.flat_provenance_sha256 !== manifest.flat_provenance_sha256 ||
        lstatSync(provenancePath).isSymbolicLink()) {
      problems.push("release index: area provenance is not bound to the manifest");
    } else {
      const provenanceBytes = readFileSync(provenancePath);
      if (digest(provenanceBytes) !== index.flat_provenance_sha256) {
        problems.push("release index: area provenance bytes differ");
      } else {
        try {
          const provenance = JSON.parse(provenanceBytes);
          assertAreaProvenance(provenance, manifest, files, index.aliases);
          verifiedProvenance = provenance;
          for (const record of Object.values(provenance.reforms)) {
            // v1: the artifact the area run read; v2: the entry's current one
            const target = areaReceiptTarget(provenance, record, manifest);
            const receiptPath = join(directory, target.artifact, "receipt.json");
            if (lstatSync(receiptPath).isSymbolicLink()) throw new Error("area receipt is a symbolic link");
            const receipt = JSON.parse(readFileSync(receiptPath));
            if (artifactDigest(receipt) !== target.artifactSha256) throw new Error("area receipt differs from approved artifact");
            assertAreaReceipt(record, receipt, provenance.schema);
          }
        } catch (error) {
          problems.push(`release index: ${error.message}`);
        }
      }
    }
    const unread = Object.keys(files).filter((name) => !FLAT_VIEW_FILES.includes(name)).sort();
    if (unread.length) problems.push(`release index: binds files no view reads: ${unread.join(", ")}`);
    const unbound = FLAT_VIEW_FILES.filter((name) => existsSync(join(directory, name)) && !Object.hasOwn(files, name));
    if (unbound.length) problems.push(`release index: flat view files published but not bound: ${unbound.join(", ")}`);
    for (const [name, expected] of Object.entries(files).sort()) {
      if (!/^[a-z][a-z0-9_]*\.csv$/.test(name) || typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
        problems.push("release index: unsafe filename or invalid SHA-256");
        continue;
      }
      const path = join(directory, name);
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        problems.push(`release index: ${name}: not a regular file`);
      } else {
        const content = readFileSync(path);
        if (digest(content) !== expected) {
          problems.push(`release index: ${name}: bytes differ`);
        } else if (verifiedProvenance) {
          try { assertAreaRows(parseCsv(content.toString("utf8")), verifiedProvenance); }
          catch (error) { problems.push(`release index: ${name}: ${error.message}`); }
        }
      }
    }
  } catch {
    problems.push("release index: manifest or index cannot be read");
  }
  return problems;
}

// As scripts/check_public_data.py: every text the area routing file may hold
// (tests/test_check_public_files_build.py checks the two sets are equal).
const AREA_ROUTING_FILE = "public/data/area-routing.json";
export const AREA_ROUTING_CONTENTS = new Set(
  [
    ["available", "local_area"],
    ["available", "area_coded_national"],
    ["not_available", null],
    ["not_available", "local_area"],
    ["not_available", "area_coded_national"],
  ].map(
    ([views, kind]) =>
      `${JSON.stringify({ area_views: views, regional_release_kind: kind }, null, 2)}\n`,
  ),
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readReview(root) {
  const [header, ...rows] = parseCsv(
    readFileSync(join(root, "data_inputs", "public_data_review.csv"), "utf8"),
  );
  const entries = new Map();
  for (const values of rows) {
    const entry = Object.fromEntries(header.map((name, i) => [name, values[i]]));
    entries.set(entry.path, entry);
  }
  return entries;
}

function* walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else yield [path, stat];
  }
}

// Whether an artifact's receipt records cells under the floor of survey
// households still in its tables (dashboard.disclosure_floor).
function thinCellsInTables(text) {
  try {
    return Boolean(JSON.parse(text)?.dashboard?.disclosure_floor?.thin_cells_in_tables);
  } catch {
    return false;
  }
}

function withheldFilesProblems(path, text) {
  let receipt;
  try { receipt = JSON.parse(text); } catch { return []; }
  const floor = receipt?.dashboard?.disclosure_floor;
  const problems = [];
  const tables = {};
  for (const table of ["distributional_impact", "winners_losers"]) {
    for (const suffix of ["csv", "json"]) {
      const file = join(path, "..", `${table}.${suffix}`);
      if (!existsSync(file)) continue;
      if (lstatSync(file).isSymbolicLink()) {
        problems.push(`${table}.${suffix}: symbolic link`);
        continue;
      }
      try {
        let rows;
        if (suffix === "json") rows = JSON.parse(readFileSync(file, "utf8"));
        else {
          const [header, ...cells] = parseCsv(readFileSync(file, "utf8"));
          rows = cells.map((row) => Object.fromEntries(header.map((column, index) => [column, column === "year" ? Number(row[index]) : row[index]])));
        }
        if (!Array.isArray(rows)) throw new Error("not a table");
        tables[table] = rows;
        problems.push(...withholdingProblems({ [table]: rows }, floor, { partial: true }));
      } catch (error) {
        problems.push(`${table}.${suffix}: ${error.message}`);
      }
    }
  }
  problems.push(...withholdingProblems(tables, floor));
  return [...new Set(problems)];
}

// The files under public/data/artifacts/ the page lists, as publish
// review-rows writes rows for them: each listed manifest entry's receipt
// and, for a displayed entry, each file that receipt binds. With no
// readable manifest, nothing there is listed.
export function listedArtifactFiles(root) {
  const listed = new Set();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "public", "data", "manifest.json"), "utf8"));
  } catch {
    return listed;
  }
  const entries = ["measures", "combined"].flatMap((group) => (isMap(manifest?.[group]) ? Object.values(manifest[group]) : []));
  for (const entry of entries) {
    if (!LISTED_STATUSES.includes(entry?.status) || typeof entry.artifact !== "string") continue;
    const artifact = `public/data/${entry.artifact}`;
    listed.add(`${artifact}/receipt.json`);
    if (entry.status === "not_computable") continue;
    try {
      const files = JSON.parse(readFileSync(join(root, artifact, "receipt.json"), "utf8")).dashboard.files;
      if (isMap(files)) for (const name of Object.keys(files)) if (!name.includes("/")) listed.add(`${artifact}/${name}`);
    } catch {
      // An unreadable receipt lists no file.
    }
  }
  return listed;
}

// The disclosure-layer tables the release index binds, by repository path
// (checkReleaseIndex verifies each one's bytes and rows).
function indexedFlatFiles(root) {
  try {
    const index = JSON.parse(readFileSync(join(root, "public", "data", "release-index.json"), "utf8"));
    return new Set(Object.keys(isMap(index.files) ? index.files : {}).filter((name) => FLAT_VIEW_FILES.includes(name)).map((name) => `public/data/${name}`));
  } catch {
    return new Set();
  }
}

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

// Whether a review row lets these exact bytes carry area codes: one of kind
// reference_geography, or pending until its expiry date, at most 14 days
// after its review, as scripts/check_public_data.py accepts them.
function areaCodesReviewed(entry, data, day) {
  if (!entry || !entry.reviewer || !entry.basis || !isDate(entry.reviewed_on) || digest(data) !== entry.sha256) return false;
  if (entry.kind === "reference_geography") return !entry.expires_on;
  if (entry.kind !== "pending" || !isDate(entry.expires_on)) return false;
  const span = daysBetween(entry.reviewed_on, entry.expires_on);
  return span >= 0 && span <= MAX_PENDING_DAYS && day <= entry.expires_on;
}

// The sign-off switch, as the tree's contract carries it. A tree without
// that contract is checked with sign-off on, the stricter reading.
export function signOffRequired(root) {
  const path = join(root, "src", "utils", "publication", "contract.json");
  if (!existsSync(path)) return true;
  return JSON.parse(readFileSync(path, "utf8")).sign_off_required !== false;
}

export function checkPublicFiles(root, today = new Date(), signOff = signOffRequired(root)) {
  const { required, optional } = JSON.parse(
    readFileSync(join(root, "scripts", "disclosure_public_columns.json"), "utf8"),
  );
  const allowed = new Set([...required, ...optional]);
  const review = signOff ? readReview(root) : new Map();
  // With sign-off off: the review list only for the area-code exemption,
  // and the files the page lists under artifacts/.
  let reviewed = new Map();
  if (!signOff) {
    try { reviewed = readReview(root); } catch { /* no review list, no exemption */ }
  }
  const listed = signOff ? new Set() : listedArtifactFiles(root);
  const indexed = signOff ? new Set() : indexedFlatFiles(root);
  const day = today.toISOString().slice(0, 10);
  const problems = checkReleaseIndex(root);
  for (const [path, stat] of walk(join(root, "public"))) {
    const name = relative(root, path).split(sep).join("/");
    if (stat.isSymbolicLink()) {
      problems.push(`${name}: symbolic link`);
      continue;
    }
    const data = readFileSync(path);
    const text = data.subarray(0, 8192).includes(0) ? null : data.toString("utf8");
    if (text !== null && RECORD_LEVEL.test(text)) {
      problems.push(`${name}: record-level identifiers`);
    }
    if (text !== null && name.endsWith("/receipt.json") && thinCellsInTables(text)) {
      problems.push(`${name}: its tables hold cells under the floor of survey households`);
    }
    if (text !== null && name.endsWith("/receipt.json")) {
      problems.push(...withheldFilesProblems(path, text).map((problem) => `${name}: ${problem}`));
    }
    if (name === AREA_ROUTING_FILE) {
      if (text === null || !AREA_ROUTING_CONTENTS.has(text)) {
        problems.push(`${name}: not an area routing status`);
      }
      if (review.has(name)) problems.push(`${name}: needs no review entry`);
      continue;
    }
    const columns =
      text === null || !name.endsWith(".csv")
        ? []
        : (parseCsv(text.replace(/^\uFEFF/, ""))[0] ?? []);
    const layerShaped = required.every((column) => columns.includes(column));
    if (!signOff) {
      if (layerShaped && !columns.every((column) => allowed.has(column))) {
        problems.push(`${name}: a disclosure table with columns the layer does not publish`);
      }
      if (name === `public/data/${AREA_PROVENANCE_FILE}`) {
        try { assertAreaProvenanceDocument(JSON.parse(text)); }
        catch { problems.push(`${name}: invalid publication provenance`); }
      }
      if (name.startsWith("public/data/artifacts/") && !listed.has(name)) {
        problems.push(`${name}: no listed manifest entry names it`);
      }
      const exempt = (layerShaped && indexed.has(name)) || areaCodesReviewed(reviewed.get(name), data, day);
      if (text !== null && !exempt && new Set(text.match(AREA_CODE) ?? []).size > MAX_AREA_CODES) {
        problems.push(`${name}: carries more than ${MAX_AREA_CODES} area codes`);
      }
      continue;
    }
    const entry = review.get(name);
    if (!entry) {
      problems.push(`${name}: not reviewed`);
      continue;
    }
    if (entry.kind === "publication_provenance" && name !== `public/data/${AREA_PROVENANCE_FILE}`) {
      problems.push(`${name}: publication provenance is only allowed for the area run's record`);
    }
    if (entry.kind === "publication_provenance") {
      try { assertAreaProvenanceDocument(JSON.parse(text)); }
      catch { problems.push(`${name}: invalid publication provenance`); }
    }
    if (name === `public/data/${AREA_PROVENANCE_FILE}` && entry.kind !== "publication_provenance") {
      problems.push(`${name}: must be reviewed as publication provenance`);
    }
    if (entry.kind === "disclosure_table") {
      if (!layerShaped || !columns.every((column) => allowed.has(column))) {
        problems.push(`${name}: reviewed as a disclosure table, but it is not one`);
        continue;
      }
    } else if (layerShaped) {
      problems.push(`${name}: reviewed as ${entry.kind}, but it is a disclosure table`);
      continue;
    }
    if (createHash("sha256").update(data).digest("hex") !== entry.sha256) {
      problems.push(`${name}: changed since its review`);
    } else if (entry.kind === "pending" && day > entry.expires_on) {
      problems.push(`${name}: pending past its expiry date (${entry.expires_on})`);
    }
  }
  return problems;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), "..", ".."));
  const problems = checkPublicFiles(root);
  for (const problem of problems) console.log(problem);
  console.log(`${problems.length} problem(s) in public/.`);
  process.exit(problems.length ? 1 : 0);
}

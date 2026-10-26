#!/usr/bin/env node
// Fail the build if a file under public/ may not be published.
//
// Every file a deploy would serve must be listed in
// data_inputs/public_data_review.csv with the sha256 of the bytes a person
// reviewed, tables from the disclosure layer included; a pending entry
// passes only until its expiry date. A file reviewed as a disclosure table
// must carry the layer's public columns, and a CSV that carries them must be
// reviewed as one. No public file may carry record-level identifiers. The
// page's area routing status takes no review entry, and must be one of the
// few texts uk_budget_data.area_routing writes.
//
// scripts/check_public_data.py runs the full check in CI, including the
// layer's validate_public. This smaller check runs in the build, so a deploy
// that skips CI cannot ship an unreviewed file. It walks the files on disk,
// which is what a deploy serves, and prints paths and rule names only.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";
import { AREA_PROVENANCE_FILE, assertAreaProvenance, assertAreaProvenanceDocument, assertAreaReceipt, assertAreaRows } from "../src/utils/publication/area.js";

const RECORD_LEVEL = /\b(?:household|benunit|person)_(?:id|weight)\b/;
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
            const receiptPath = join(directory, record.artifact, "receipt.json");
            if (lstatSync(receiptPath).isSymbolicLink()) throw new Error("area receipt is a symbolic link");
            const receipt = JSON.parse(readFileSync(receiptPath));
            if (artifactDigest(receipt) !== record.artifact_sha256) throw new Error("area receipt differs from approved artifact");
            assertAreaReceipt(record, receipt);
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

export function checkPublicFiles(root, today = new Date()) {
  const { required, optional } = JSON.parse(
    readFileSync(join(root, "scripts", "disclosure_public_columns.json"), "utf8"),
  );
  const allowed = new Set([...required, ...optional]);
  const review = readReview(root);
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
    if (name === AREA_ROUTING_FILE) {
      if (text === null || !AREA_ROUTING_CONTENTS.has(text)) {
        problems.push(`${name}: not an area routing status`);
      }
      if (review.has(name)) problems.push(`${name}: needs no review entry`);
      continue;
    }
    const entry = review.get(name);
    if (!entry) {
      problems.push(`${name}: not reviewed`);
      continue;
    }
    const columns =
      text === null || !name.endsWith(".csv")
        ? []
        : (parseCsv(text.replace(/^\uFEFF/, ""))[0] ?? []);
    const layerShaped = required.every((column) => columns.includes(column));
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

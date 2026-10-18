#!/usr/bin/env node
// Fail the build if a file under public/ may not be published.
//
// Every file a deploy would serve must be listed in
// data_inputs/public_data_review.csv with the sha256 of the bytes a person
// reviewed, tables from the disclosure layer included; a pending entry
// passes only until its expiry date. A file reviewed as a disclosure table
// must carry the layer's public columns, and a CSV that carries them must be
// reviewed as one. No public file may carry record-level identifiers.
//
// scripts/check_public_data.py runs the full check in CI, including the
// layer's validate_public. This smaller check runs in the build, so a deploy
// that skips CI cannot ship an unreviewed file. It walks the files on disk,
// which is what a deploy serves, and prints paths and rule names only.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RECORD_LEVEL = /\b(?:household|benunit|person)_(?:id|weight)\b/;

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
  const problems = [];
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

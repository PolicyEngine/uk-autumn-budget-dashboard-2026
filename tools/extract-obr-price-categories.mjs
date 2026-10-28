#!/usr/bin/env node
// Write public/data/obr_price_categories.json: the OBR's forecast of CPI
// inflation by spending category, from Table 1.19 ("CPI category
// inflation") of the economy detailed forecast tables of the Economic and
// fiscal outlook, March 2026 (data_inputs/living_standards/
// efo-march-2026-detailed-forecast-tables-economy.xlsx). One value per
// category and fiscal year, 2026-27 to 2030-31: year-on-year growth in
// percent, as the OBR publishes it, rounded to 4 decimal places.
//
// The categories are the OBR's own five, under the OBR's names. The table
// gives no all-items CPI, so the file carries none.
//
// Node built-ins only (the xlsx is a zip of XML: its central directory is
// read here and each part inflated with zlib), so no dependency is added.
// The output holds no timestamp: the same xlsx gives the same bytes.
//
//   node tools/extract-obr-price-categories.mjs [xlsx] [out.json]
//   node tools/extract-obr-price-categories.mjs --release october-2026
//
// --release october-2026 reads the October 2026 tables
// (data_inputs/living_standards/efo-october-2026-detailed-forecast-tables-
// economy.xlsx) into public/data/obr_price_categories_october_2026.json,
// which the card draws beside March's with the "Show forecasts" chips.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Each release the card can draw: its workbook, output and source record
const RELEASES = {
  "march-2026": {
    xlsx: "data_inputs/living_standards/efo-march-2026-detailed-forecast-tables-economy.xlsx",
    out: "public/data/obr_price_categories.json",
    release: "Economic and fiscal outlook, March 2026",
    release_date: "2026-03-03",
    workbook: "Economic and fiscal outlook, March 2026: detailed forecast tables, economy",
    url: "https://obr.uk/download/march-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/",
    page_url: "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
    vintage: "OBR March 2026 forecast (before the Autumn Budget 2026)",
  },
  "october-2026": {
    xlsx: "data_inputs/living_standards/efo-october-2026-detailed-forecast-tables-economy.xlsx",
    out: "public/data/obr_price_categories_october_2026.json",
    release: "Economic and fiscal outlook, October 2026",
    release_date: "2026-10-28",
    workbook: "Economic and fiscal outlook, October 2026: detailed forecast tables, economy",
    url: "https://obr.uk/download/october-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/",
    page_url: "https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/",
    vintage: "OBR October 2026 forecast (the Autumn Budget 2026)",
  },
};
const releaseFlag = process.argv.indexOf("--release");
const RELEASE = RELEASES[releaseFlag >= 0 ? process.argv[releaseFlag + 1] : "march-2026"];
if (!RELEASE) throw new Error(`--release must be one of ${Object.keys(RELEASES).join(", ")}`);
const positional = releaseFlag >= 0 ? [] : process.argv.slice(2);
const XLSX = positional[0] ?? join(ROOT, RELEASE.xlsx);
const OUT = positional[1] ?? join(ROOT, RELEASE.out);

const SHEET = "1.19";
const TITLE = "1.19 CPI category inflation";
const YEARS = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"];
// The OBR's column heading, the file's key for it
const CATEGORIES = [
  ["Food, beverages and tobacco", "food"],
  ["Utilities", "utilities"],
  ["Fuels", "fuels"],
  ["Other tradables", "other_tradables"],
  ["Other non-tradables", "other_non_tradables"],
];

/** Every file in a zip, as { name: Buffer }, from its central directory. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The sheet's cells as { "B2": value }, strings resolved. */
function readSheet(files, sheetName) {
  const text = (n) => files[n]?.toString("utf8") ?? "";
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const sheet = [...text("xl/workbook.xml").matchAll(/<sheet [^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g)].find((m) => unescape(m[1]) === sheetName);
  if (!sheet) throw new Error(`no sheet ${sheetName}`);
  const rel = [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)]
    .map((m) => m[0])
    .find((r) => r.includes(`Id="${sheet[2]}"`));
  const target = rel.match(/Target="([^"]*)"/)[1].replace(/^\/?xl\//, "");
  const cells = {};
  for (const c of text(`xl/${target}`).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = (c[3] ?? "").match(/<v>([\s\S]*?)<\/v>/);
    if (!v) continue;
    cells[c[1]] = /t="s"/.test(c[2]) ? shared[Number(v[1])] : /t="str"/.test(c[2]) ? unescape(v[1]) : Number(v[1]);
  }
  return cells;
}

const bytes = readFileSync(XLSX);
const cells = readSheet(unzip(bytes), SHEET);
if (cells.B2 !== TITLE) throw new Error(`sheet ${SHEET} is "${cells.B2}", not "${TITLE}"`);
if (cells.C3 !== "Year-on-year growth") throw new Error(`sheet ${SHEET} units are "${cells.C3}"`);

// The header row names the categories; the year rows are in column B
const header = Object.entries(cells).filter(([ref]) => /^[C-Z]4$/.test(ref));
const columnOf = Object.fromEntries(header.map(([ref, label]) => [label, ref.replace(/\d+$/, "")]));
const rowOf = Object.fromEntries(Object.entries(cells).filter(([ref]) => /^B\d+$/.test(ref)).map(([ref, label]) => [String(label), ref.slice(1)]));
if (header.length !== CATEGORIES.length) throw new Error(`table has ${header.length} categories, expected ${CATEGORIES.length}`);

const round = (v) => Math.round(v * 1e4) / 1e4;
const series = CATEGORIES.map(([label, key]) => {
  const col = columnOf[label];
  if (!col) throw new Error(`no column "${label}"`);
  return {
    key,
    label,
    values: YEARS.map((year) => {
      const v = cells[`${col}${rowOf[year]}`];
      if (!Number.isFinite(v)) throw new Error(`no value for ${label}, ${year}`);
      return { year, value: round(v) };
    }),
  };
});

const out = {
  schema: "uk-budget-dashboard/obr-price-categories/v1",
  source: {
    publisher: "Office for Budget Responsibility",
    release: RELEASE.release,
    release_date: RELEASE.release_date,
    table: "Table 1.19",
    table_title: "CPI category inflation",
    workbook: RELEASE.workbook,
    url: RELEASE.url,
    page_url: RELEASE.page_url,
    file: relative(ROOT, XLSX),
    file_sha256: createHash("sha256").update(bytes).digest("hex"),
  },
  vintage: RELEASE.vintage,
  units: "Year-on-year growth in the category's CPI index (%), fiscal years (April to March)",
  decimals: 4,
  generated_by: "tools/extract-obr-price-categories.mjs",
  series,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${relative(ROOT, OUT)}: ${series.length} categories, ${YEARS[0]} to ${YEARS.at(-1)}`);

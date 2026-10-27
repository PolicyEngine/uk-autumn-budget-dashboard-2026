#!/usr/bin/env node
// Fetch the ONS series behind the "Prices by spending category since July
// 2021" card and write public/data/price_categories.json.
//
// Each series comes from the ONS time series API (www.ons.gov.uk/<topic>/
// timeseries/<cdid>/<dataset>/data): CPI indices (2015=100) from the
// Consumer price inflation dataset MM23, and average weekly earnings
// (seasonally adjusted total pay, £) from the Labour market statistics
// dataset LMS. The file holds the monthly levels from January 2021 to the
// latest month, as published; the page (src/utils/livingStandards/
// priceCategories.js) computes each month's change since July 2021. The
// output carries no fetch time, so a rerun on the same ONS releases writes
// the same bytes (and the same sha256 in data_inputs/public_data_review.csv).
//
// Run: node tools/fetch-ons-price-categories.mjs [--out path]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "uk-budget-dashboard/price-categories/v1";
const START = "2021-01";
const BASE_MONTH = "2021-07";
const PRICES = "economy/inflationandpriceindices";
const EARNINGS = "employmentandlabourmarket/peopleinwork/earningsandworkinghours";

// key, CDID, dataset, topic path, and the title the ONS must report for it
export const SERIES = [
  { key: "cpi", cdid: "D7BT", dataset: "MM23", topic: PRICES, title: "CPI INDEX 00: ALL ITEMS 2015=100" },
  { key: "energy", cdid: "D7CH", dataset: "MM23", topic: PRICES, title: "CPI INDEX 04.5 : ELECTRICITY, GAS AND OTHER FUELS 2015=100" },
  { key: "food", cdid: "D7BU", dataset: "MM23", topic: PRICES, title: "CPI INDEX 01 : FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100" },
  { key: "rents", cdid: "D7CE", dataset: "MM23", topic: PRICES, title: "CPI INDEX 04.1 : ACTUAL RENTS FOR HOUSING 2015=100" },
  { key: "water", cdid: "D7DR", dataset: "MM23", topic: PRICES, title: "CPI INDEX 04.4.1 : WATER SUPPLY 2015=100" },
  { key: "rail", cdid: "D7EF", dataset: "MM23", topic: PRICES, title: "CPI INDEX 07.3.1 : PASSENGER TRANSPORT BY RAILWAY 2015=100" },
  { key: "services", cdid: "D7F5", dataset: "MM23", topic: PRICES, title: "CPI INDEX: Services 2015=100" },
  {
    key: "earnings",
    cdid: "KAB9",
    dataset: "LMS",
    topic: EARNINGS,
    title: "AWE: Whole Economy Level (£): Seasonally Adjusted Total Pay Excluding Arrears",
  },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2021 JUL" -> "2021-07". */
export function monthKey(date) {
  const [year, mon] = String(date).trim().split(/\s+/);
  const i = MONTHS.indexOf(String(mon).toUpperCase());
  if (!/^\d{4}$/.test(year) || i < 0) throw new Error(`unreadable ONS month: ${date}`);
  return `${year}-${String(i + 1).padStart(2, "0")}`;
}

/** An ONS release time (midnight UK time, stored in UTC) as its UK date. */
export function ukDate(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

/** One series' record from the ONS response, months from START on. */
export function toRecord(spec, body) {
  const d = body.description || {};
  if (d.cdid !== spec.cdid || d.datasetId !== spec.dataset) throw new Error(`${spec.cdid}: the ONS returned ${d.cdid}/${d.datasetId}`);
  if (d.title !== spec.title) throw new Error(`${spec.cdid}: title is "${d.title}", expected "${spec.title}"`);
  const values = (body.months || [])
    .map((m) => ({ month: monthKey(m.date), value: Number(m.value) }))
    .filter((m) => m.month >= START)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (values.some((m) => !Number.isFinite(m.value))) throw new Error(`${spec.cdid}: a non-numeric value`);
  if (!values.some((m) => m.month === BASE_MONTH)) throw new Error(`${spec.cdid}: no ${BASE_MONTH} value`);
  return {
    key: spec.key,
    cdid: spec.cdid,
    dataset: spec.dataset,
    title: d.title,
    unit: (d.preUnit || d.unit || "").trim(),
    seasonally_adjusted: /seasonally adjusted/i.test(d.title),
    source_url: `https://www.ons.gov.uk/${spec.topic}/timeseries/${spec.cdid.toLowerCase()}/${spec.dataset.toLowerCase()}`,
    release_date: ukDate(d.releaseDate),
    next_release: d.nextRelease || null,
    values,
  };
}

async function fetchSeries(spec) {
  const url = `https://www.ons.gov.uk/${spec.topic}/timeseries/${spec.cdid.toLowerCase()}/${spec.dataset.toLowerCase()}/data`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "policyengine-uk-autumn-budget-dashboard" } });
  if (!response.ok) throw new Error(`${spec.cdid}: HTTP ${response.status} from ${url}`);
  return toRecord(spec, await response.json());
}

async function main() {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : join(ROOT, "public", "data", "price_categories.json");
  const series = [];
  // One request at a time: the ONS API limits request rates
  for (const spec of SERIES) series.push(await fetchSeries(spec));
  const document = {
    schema: SCHEMA,
    publisher: "Office for National Statistics",
    start_month: START,
    base_month: BASE_MONTH,
    values: "Monthly levels as the ONS publishes them; the page computes each month's change since the base month.",
    series,
  };
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  for (const s of series) console.log(`${s.cdid} ${s.dataset} ${s.values[0].month}..${s.values.at(-1).month} released ${s.release_date}`);
  console.log(`wrote ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

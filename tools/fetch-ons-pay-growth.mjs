#!/usr/bin/env node
// Fetch the ONS series behind the "Pay growth: public and private sector"
// card and write public/data/pay_growth_sectors.json.
//
// Each series comes from the ONS time series API (www.ons.gov.uk/<topic>/
// timeseries/<cdid>/<dataset>/data): average weekly earnings, regular pay
// (excluding bonuses and arrears), seasonally adjusted, year-on-year growth
// of the three-month average, in percent, for the public sector, the
// private sector and the whole economy, from the Labour market statistics
// dataset LMS. The ONS labels each three-month window by its last month.
// The file holds the monthly values from January 2021 to the latest month,
// as published; the page (src/utils/livingStandards/paySectors.js) derives
// nothing from them. The output carries no fetch time, so a rerun on the
// same ONS release writes the same bytes (and the same sha256 in
// data_inputs/public_data_review.csv).
//
// Run: node tools/fetch-ons-pay-growth.mjs [--out path]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "uk-budget-dashboard/pay-growth-sectors/v1";
const START = "2021-01";
const EARNINGS = "employmentandlabourmarket/peopleinwork/earningsandworkinghours";
const TITLE = (who) => `AWE: ${who} Year on Year Three Month Average Growth (%): Seasonally Adjusted Regular Pay Excluding Arrears`;

// key, CDID, dataset, topic path, and the title the ONS must report for it
export const SERIES = [
  { key: "public", cdid: "KAJ7", dataset: "LMS", topic: EARNINGS, title: TITLE("Public Sector") },
  { key: "private", cdid: "KAJ4", dataset: "LMS", topic: EARNINGS, title: TITLE("Private Sector") },
  { key: "whole", cdid: "KAI9", dataset: "LMS", topic: EARNINGS, title: TITLE("Whole Economy") },
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
  if (!values.some((m) => m.month === START)) throw new Error(`${spec.cdid}: no ${START} value`);
  return {
    key: spec.key,
    cdid: spec.cdid,
    dataset: spec.dataset,
    title: d.title,
    // The ONS leaves the unit blank on some of these series; all are growth rates
    unit: "%",
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
  const out = i > 0 ? process.argv[i + 1] : join(ROOT, "public", "data", "pay_growth_sectors.json");
  const series = [];
  // One request at a time: the ONS API limits request rates
  for (const spec of SERIES) series.push(await fetchSeries(spec));
  const document = {
    schema: SCHEMA,
    publisher: "Office for National Statistics",
    start_month: START,
    values: "Year-on-year growth of the three-month average, in percent, as the ONS publishes it; each month ends its three-month window. The page derives nothing from them.",
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

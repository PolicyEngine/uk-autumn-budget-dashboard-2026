// Pay growth by sector: loads public/data/pay_growth_sectors.json (written
// by tools/fetch-ons-pay-growth.mjs from the ONS time series API): average
// weekly earnings, regular pay, year-on-year growth of the three-month
// average, in percent, for the public sector, the private sector and the
// whole economy. The file holds the growth rates as the ONS publishes them;
// the page draws them as they are.

import { formatOneDp } from "./outlook";
import { monthLabel } from "./priceCategories";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const PAY_SECTORS_PATH = "/data/pay_growth_sectors.json";
export const PAY_SECTORS_SCHEMA = "uk-budget-dashboard/pay-growth-sectors/v1";

let cached = null;

/** Whether a parsed file has the shape the card reads. */
export function isPaySectors(data) {
  return (
    data?.schema === PAY_SECTORS_SCHEMA &&
    Array.isArray(data.series) &&
    data.series.length > 0 &&
    data.series.every((s) => s.key && s.cdid && Array.isArray(s.values) && s.values.length > 0 && s.values.every((v) => /^\d{4}-\d{2}$/.test(v.month) && Number.isFinite(v.value)))
  );
}

/**
 * Load the file once per page. Returns { data, error, unavailable }: a file
 * not published yet (HTTP 404, before its review row) is `unavailable`; an
 * unreadable or wrongly shaped one is an error; never a throw.
 */
export function loadPaySectors() {
  if (!cached) {
    cached = fetch(`${BASE}${PAY_SECTORS_PATH}`)
      .then((r) => {
        if (r.status === 404) return { data: null, error: null, unavailable: true };
        if (!r.ok) throw new Error(`${PAY_SECTORS_PATH}: HTTP ${r.status}`);
        return r.json().then((data) => {
          if (!isPaySectors(data)) throw new Error(`${PAY_SECTORS_PATH}: not a pay growth file`);
          return { data, error: null, unavailable: false };
        });
      })
      .then((result) => {
        if (!result.data) cached = null;
        return result;
      })
      .catch((error) => {
        cached = null;
        return { data: null, error: error.message, unavailable: false };
      });
  }
  return cached;
}

/** Forget the loaded file (tests). */
export function clearPaySectorsCache() {
  cached = null;
}

/** One row per month, { month, <key>: growth % }, a series without that month left null. */
export function growthRows(data) {
  const byKey = Object.fromEntries(data.series.map((s) => [s.key, Object.fromEntries(s.values.map((v) => [v.month, v.value]))]));
  const months = [...new Set(data.series.flatMap((s) => s.values.map((v) => v.month)))].sort();
  return months.map((month) => ({ month, ...Object.fromEntries(data.series.map((s) => [s.key, byKey[s.key][month] ?? null])) }));
}

const pct = (v) => `${formatOneDp(v)}%`;

/**
 * The card's one sentence, from the latest month both sectors share:
 * "In the three months to August 2026, public-sector regular pay grew 6.3%
 * and private-sector 3.0%."
 */
export function paySectorsSentence(rows) {
  const row = [...rows].reverse().find((r) => r.public != null && r.private != null);
  if (!row) return null;
  return `In the three months to ${monthLabel(row.month)}, public-sector regular pay grew ${pct(row.public)} and private-sector ${pct(row.private)}.`;
}

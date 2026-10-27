// Prices by spending category: loads public/data/price_categories.json
// (written by tools/fetch-ons-price-categories.mjs from the ONS time series
// API) and turns its monthly ONS levels into each month's change since the
// base month (July 2021), in percent. The file holds the levels as
// published; every change on the page is computed here.

import { formatOneDp } from "./outlook";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const PRICE_CATEGORIES_PATH = "/data/price_categories.json";
export const PRICE_CATEGORIES_SCHEMA = "uk-budget-dashboard/price-categories/v1";

let cached = null;

/** Whether a parsed file has the shape the card reads. */
export function isPriceCategories(data) {
  return (
    data?.schema === PRICE_CATEGORIES_SCHEMA &&
    /^\d{4}-\d{2}$/.test(data.base_month ?? "") &&
    Array.isArray(data.series) &&
    data.series.length > 0 &&
    data.series.every((s) => s.key && s.cdid && Array.isArray(s.values) && s.values.some((v) => v.month === data.base_month))
  );
}

/**
 * Load the file once per page. Returns { data, error }; a missing,
 * unreadable or wrongly shaped file is an error, never a throw.
 */
export function loadPriceCategories() {
  if (!cached) {
    cached = fetch(`${BASE}${PRICE_CATEGORIES_PATH}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${PRICE_CATEGORIES_PATH}: HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!isPriceCategories(data)) throw new Error(`${PRICE_CATEGORIES_PATH}: not a price categories file`);
        return { data, error: null };
      })
      .catch((error) => {
        cached = null;
        return { data: null, error: error.message };
      });
  }
  return cached;
}

/** Forget the loaded file (tests). */
export function clearPriceCategoriesCache() {
  cached = null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2021-07" -> "July 2021". */
export const monthLabel = (month) => {
  const [y, m] = String(month).split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

/** "2021-07" -> "Jul 2021" (tooltips and tight labels). */
export const monthShort = (month) => monthLabel(month).replace(/^(\w{3})\w*/, "$1");

/** "2022-01" -> "2022" (axis ticks, which fall on Januaries). */
export const monthYear = (month) => String(month).slice(0, 4);

/** Percent change of `value` on `base`. */
export const changeOn = (value, base) => (value / base - 1) * 100;

/**
 * One row per month, { month, <key>: % change since the base month }, a
 * series without that month left null. Months run from the file's first to
 * its last across all series.
 */
export function changeRows(data) {
  const byKey = Object.fromEntries(
    data.series.map((s) => {
      const base = s.values.find((v) => v.month === data.base_month).value;
      return [s.key, Object.fromEntries(s.values.map((v) => [v.month, changeOn(v.value, base)]))];
    }),
  );
  const months = [...new Set(data.series.flatMap((s) => s.values.map((v) => v.month)))].sort();
  return months.map((month) => ({ month, ...Object.fromEntries(data.series.map((s) => [s.key, byKey[s.key][month] ?? null])) }));
}

/** Each series' latest month and change since the base: { key: { month, change } }. */
export function latestChanges(rows, keys) {
  return Object.fromEntries(
    keys.map((key) => {
      const row = [...rows].reverse().find((r) => r[key] != null);
      return [key, row ? { month: row.month, change: row[key] } : null];
    }),
  );
}

/** The January months in the rows: the axis ticks, one a year. */
export function yearTicks(rows) {
  return rows.map((r) => r.month).filter((m) => m.endsWith("-01"));
}

const pct = (v) => `${formatOneDp(v)}%`;

/**
 * The card's one sentence, from the latest months: energy and food against
 * all prices (CPI) and average earnings since the base month, the earnings
 * month named (year only when it differs) where it ends before the prices.
 */
export function priceCategoriesSentence(rows, baseMonth) {
  const l = latestChanges(rows, ["energy", "food", "cpi", "earnings"]);
  if (!l.energy || !l.food || !l.cpi) return null;
  const lead = `Since ${monthLabel(baseMonth)}, energy prices are up ${pct(l.energy.change)} and food ${pct(l.food.change)}, against ${pct(l.cpi.change)} for CPI`;
  if (!l.earnings) return `${lead}.`;
  const sameYear = l.earnings.month.slice(0, 4) === l.cpi.month.slice(0, 4);
  const to = sameYear ? monthLabel(l.earnings.month).split(" ")[0] : monthLabel(l.earnings.month);
  const when = l.earnings.month === l.cpi.month ? "" : ` (to ${to})`;
  return `${lead} and ${pct(l.earnings.change)} for earnings${when}.`;
}

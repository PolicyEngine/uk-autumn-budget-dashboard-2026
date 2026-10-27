// Prices by spending category, OBR forecast: loads
// public/data/obr_price_categories.json (written by
// tools/extract-obr-price-categories.mjs from Table 1.19 of the OBR's March
// 2026 economy detailed forecast tables): year-on-year CPI inflation for the
// OBR's five categories, fiscal years 2026-27 to 2030-31. The page draws the
// rates as the file holds them.

import { formatOneDp, fyLabel } from "./outlook";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const OBR_PRICE_CATEGORIES_PATH = "/data/obr_price_categories.json";
export const OBR_PRICE_CATEGORIES_SCHEMA = "uk-budget-dashboard/obr-price-categories/v1";

const FY = /^(\d{4})-\d{2}$/;
let cached = null;

/** Whether a parsed file has the shape the card reads. */
export function isObrPriceCategories(data) {
  return (
    data?.schema === OBR_PRICE_CATEGORIES_SCHEMA &&
    Array.isArray(data.series) &&
    data.series.length > 0 &&
    data.series.every(
      (s) => s.key && s.label && Array.isArray(s.values) && s.values.length > 0 && s.values.every((v) => FY.test(v.year) && Number.isFinite(v.value)),
    )
  );
}

/**
 * Load the file once per page. Returns { data, error, unavailable }: a file
 * not published yet (HTTP 404, before its review row) is `unavailable`; an
 * unreadable or wrongly shaped one is an error; never a throw.
 */
export function loadObrPriceCategories() {
  if (!cached) {
    cached = fetch(`${BASE}${OBR_PRICE_CATEGORIES_PATH}`)
      .then((r) => {
        if (r.status === 404) return { data: null, error: null, unavailable: true };
        if (!r.ok) throw new Error(`${OBR_PRICE_CATEGORIES_PATH}: HTTP ${r.status}`);
        return r.json().then((data) => {
          if (!isObrPriceCategories(data)) throw new Error(`${OBR_PRICE_CATEGORIES_PATH}: not an OBR price categories file`);
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
export function clearObrPriceCategoriesCache() {
  cached = null;
}

/** One row per fiscal year, { year: its first calendar year, <key>: growth % }, a missing value null. */
export function categoryRows(data) {
  const byKey = Object.fromEntries(data.series.map((s) => [s.key, Object.fromEntries(s.values.map((v) => [Number(v.year.match(FY)[1]), v.value]))]));
  const years = [...new Set(data.series.flatMap((s) => s.values.map((v) => Number(v.year.match(FY)[1]))))].sort((a, b) => a - b);
  return years.map((year) => ({ year, ...Object.fromEntries(data.series.map((s) => [s.key, byKey[s.key][year] ?? null])) }));
}

const pct = (v) => `${formatOneDp(Math.abs(v))}%`;
const move = (v) => (v < 0 ? `fall ${pct(v)}` : `rise ${pct(v)}`);

/**
 * The card's one sentence, from the first year: the category the OBR
 * expects to rise most and the one it expects to rise least (or fall):
 * "In 2026-27 the OBR expects food, beverages and tobacco prices to rise
 * 3.1% and utilities prices to fall 8.0%." names: key => name in a sentence.
 */
export function obrPriceCategoriesSentence(rows, names) {
  const row = rows[0];
  if (!row) return null;
  const ranked = Object.keys(names)
    .filter((k) => row[k] != null)
    .sort((a, b) => row[b] - row[a]);
  if (ranked.length < 2) return null;
  const top = ranked[0];
  const bottom = ranked.at(-1);
  return `In ${fyLabel(row.year)} the OBR expects ${names[top]} prices to ${move(row[top])} and ${names[bottom]} prices to ${move(row[bottom])}.`;
}

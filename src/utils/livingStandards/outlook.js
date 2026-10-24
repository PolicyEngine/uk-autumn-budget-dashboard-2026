// Data loading and formatting helpers for the Living standards view, which
// reads public/data/living_standards_outlook.json: a copy of outlook.json
// from PolicyEngine/uk-living-standards-outlook (shape in that repo's
// DATA_CONTRACT.md).

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const OUTLOOK_PATH = "/data/living_standards_outlook.json";

let cached = null;

/**
 * Load the outlook once per page. Returns { data, error }. A missing or
 * unreadable file is an error, never placeholder numbers.
 */
export function loadOutlook() {
  if (!cached) {
    cached = fetch(`${BASE}${OUTLOOK_PATH}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${OUTLOOK_PATH}: HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => ({ data, error: null }))
      .catch((error) => {
        cached = null;
        return { data: null, error: error.message };
      });
  }
  return cached;
}

/** "2024-25" -> 2024 (numeric x value for the line chart). */
export const fyStart = (fy) => parseInt(String(fy).slice(0, 4), 10);

/** 2030 -> "2030-31", written as on the rest of the page. */
export const fyLabel = (start) => `${start}-${String(start + 1).slice(-2)}`;

/**
 * Fiscal years in text, written as on the rest of the page: "2025-26". The
 * data already use that form; an en dash ("2025–26") becomes a hyphen.
 */
export const fyDash = (fy) => String(fy ?? "").replace(/(\d{4})–(\d{2})(?!\d)/g, "$1-$2");

const gb = (opts) => new Intl.NumberFormat("en-GB", opts);
const pct1 = gb({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const k1 = gb({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const k0 = gb({ maximumFractionDigits: 0 });

/** 41234 -> "£41.2k"; 719 -> "£719" (weekly or equivalised figures stay in pounds). */
export const formatPounds = (v) => (Math.abs(v) >= 10000 ? `£${k1.format(v / 1000)}k` : `£${k0.format(v)}`);
/** Axis tick formatters: "£40k" style, or whole pounds for small scales. */
export const formatPoundsKAxis = (v) => `£${k0.format(v / 1000)}k`;
export const formatPoundsWholeAxis = (v) => `£${k0.format(v)}`;
/** 13.2 (already a percentage) -> "13.2%" */
export const formatPct = (v) => `${pct1.format(v)}%`;
/** Axis ticks: 12 -> "12%" */
export const formatPctAxis = (v) => `${k0.format(v)}%`;
/** 1.06 -> "1.1" */
export const formatOneDp = (v) => pct1.format(v);

/** Round an axis maximum up to a tidy value. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const padded = v * 1.1;
  const mag = 10 ** Math.floor(Math.log10(padded));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];
  const n = padded / mag;
  return (steps.find((s) => s >= n) ?? 10) * mag;
}

/** Pull the first http(s) URL out of free text. */
export function splitSource(text) {
  if (!text) return { label: "", url: null };
  const m = String(text).match(/https?:\/\/\S+/);
  if (!m) return { label: String(text), url: null };
  const url = m[0].replace(/[).,;]+$/, "");
  const label = String(text).replace(m[0], "").replace(/[\s:;,(–-]+$/, "").trim();
  return { label: label || url, url };
}

/** End year for headline comparisons (meta.headline_end_year, e.g. "2029-30"). */
export const headlineYear = (data) => data?.meta?.headline_end_year || null;

/**
 * Start year for headline changes (meta.headline_start_year): 2026-27, the
 * fiscal year of Autumn Budget 2026 and the data's own base year.
 */
export const headlineStartYear = (data) => data?.meta?.headline_start_year || null;

/**
 * Headline-start row (2026-27; the first row if absent) and the headline-year
 * row (or the last row) of a projection. Series that also carry earlier
 * model years still report change from 2026-27.
 */
export function headlineSpan(rows, data) {
  if (!rows || rows.length < 2) return null;
  const start = headlineStartYear(data);
  const end = headlineYear(data);
  const first = (start && rows.find((r) => r.year === start)) || rows[0];
  const last = (end && rows.find((r) => r.year === end)) || rows[rows.length - 1];
  return first === last ? null : [first, last];
}

/** Round to one decimal place, so a change agrees with the values shown. */
export const round1 = (v) => (v == null ? v : Math.round(v * 10) / 10);

/** "rises 10.0%" / "falls 1.3pp" / null when the change rounds to zero. */
export function changeVerb(delta, unit) {
  const r = round1(delta);
  if (r == null || r === 0) return null;
  return `${r > 0 ? "rises" : "falls"} ${formatOneDp(Math.abs(r))}${unit}`;
}

/**
 * A change at one decimal place, signed after rounding: "+0.3pp", "−1.2%",
 * or `zero` ("no change") when it rounds to 0, never "−0.0".
 */
export function signedChange(delta, unit, zero = "no change") {
  const r = round1(delta);
  if (r == null || Number.isNaN(r)) return "—";
  if (r === 0) return zero;
  return `${r > 0 ? "+" : "−"}${formatOneDp(Math.abs(r))}${unit}`;
}

/** The years a card covers: "2026-27 to 2029-30" (or one year alone). */
export function periodLabel(from, to) {
  if (from == null || to == null) return null;
  const a = typeof from === "number" ? fyLabel(from) : fyDash(from);
  const b = typeof to === "number" ? fyLabel(to) : fyDash(to);
  return a === b ? a : `${a} to ${b}`;
}

/** The first and last x values of chart rows, as a period. */
export const rowsPeriod = (rows, key = "year", format = (v) => v) =>
  rows?.length ? periodLabel(format(rows[0][key]), format(rows[rows.length - 1][key])) : null;

/** 2030 -> "30-31", for phone axes. */
export const fyShortLabel = (start) => `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The dataset in a few words, from meta.dataset:
 * "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71" ->
 * { name: "Microcosm UK national", date: "19 Oct 2026", id: "6cba5d71" }.
 */
export function describeDataset(ds = {}) {
  const tag = ds.tag || "";
  const base = /^microcosm[_-]uk/i.test(ds.name || tag) ? "Microcosm UK" : ds.name || tag;
  const name = /national/i.test(tag) ? `${base} national` : base;
  const m = tag.match(/(\d{4})(\d{2})(\d{2})T\d+Z-([0-9a-f]{6,})$/i);
  if (m) return { name, date: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`, id: m[4].slice(0, 8) };
  return { name, date: null, id: ds.sha256 ? String(ds.sha256).slice(0, 8) : null };
}

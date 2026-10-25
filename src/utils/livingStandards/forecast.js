import { zeroBasedAxis } from "../chartTheme";
// Helpers for the forecast tab. Values arrive as fractions; shown in percent.

import { formatOneDp, round1, signedChange } from "./outlook";

/**
 * The year the headline tiles show: the first year of the forecast series
 * (2027, the first year of the dashboard's period), read from the data.
 */
export function heroYear(forecast) {
  const years = (forecast?.sections || []).flatMap((s) => s.series.flatMap((series) => (series.pre || []).map((p) => p.year)));
  return years.length ? years.reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null;
}

export const pctLabel = (v) => (v == null ? "—" : `${formatOneDp(v)}%`);
/** A change in points, signed after rounding: "+0.3pp", "−0.2pp", "0.0pp". */
export const ppLabel = (v) => (v == null ? "—" : signedChange(v, "pp", "0.0pp"));
/** As ppLabel, but "no change" when it rounds to zero (tiles). */
export const ppWords = (v) => (v == null ? "—" : signedChange(v, "pp"));
export const changeClass = (v) => {
  const r = round1(v);
  return r == null || r === 0 ? "change-zero" : r > 0 ? "change-positive" : "change-negative";
};

/**
 * Join pre/post into rows of { year, previous, updated, change, shownChange }
 * in percent. change is exact (for the CSV); shownChange is the difference
 * of the one-decimal values shown, so "2.3% → 2.6%" reads +0.3pp.
 */
export function toRows(series, published) {
  const post = Object.fromEntries((series.post || []).map((p) => [p.year, p.value]));
  return (series.pre || []).map((p) => {
    const previous = p.value == null ? null : p.value * 100;
    const updated = published && post[p.year] != null ? post[p.year] * 100 : null;
    const both = previous != null && updated != null;
    return {
      year: p.year,
      previous,
      updated,
      change: both ? updated - previous : null,
      shownChange: both ? round1(updated) - round1(previous) : null,
    };
  });
}

/** The y axis for the drawn values, from 0 (chartTheme.zeroBasedAxis). */
export function percentAxis(values) {
  return zeroBasedAxis(values, { pad: 0.1 });
}

/** "OBR March 2026 (pre-Budget)" -> "OBR March 2026". */
export const forecastName = (label) => String(label || "").replace(/\s*\((pre-Budget|Autumn Budget|Budget)\)\s*$/i, "");

export const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// Helpers for the forecast tab. Values arrive as fractions; shown in percent.

import { formatOneDp } from "./outlook";

export const HERO_YEAR = "2026";

export const pctLabel = (v) => (v == null ? "—" : `${formatOneDp(v)}%`);
export const ppLabel = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${formatOneDp(v)}pp`);
export const changeClass = (v) =>
  v == null || Math.abs(v) < 0.05 ? "change-zero" : v > 0 ? "change-positive" : "change-negative";

/** Join pre/post into rows of { year, previous, updated, change } in percent. */
export function toRows(series, published) {
  const post = Object.fromEntries((series.post || []).map((p) => [p.year, p.value]));
  return (series.pre || []).map((p) => {
    const previous = p.value == null ? null : p.value * 100;
    const updated = published && post[p.year] != null ? post[p.year] * 100 : null;
    return {
      year: p.year,
      previous,
      updated,
      change: previous != null && updated != null ? updated - previous : null,
    };
  });
}

/** Tidy y-axis domain and ticks around the drawn values. */
export function percentAxis(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = dataMax - dataMin;
  const step = range <= 2 ? 0.5 : range <= 5 ? 1 : 2;
  const yMin = Math.floor(dataMin / step - 1) * step;
  const yMax = Math.ceil(dataMax / step + 1) * step;
  const ticks = [];
  for (let v = yMin; v <= yMax + step * 0.01; v += step) ticks.push(Math.round(v * 10) / 10);
  return { domain: [yMin, yMax], ticks };
}

export const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

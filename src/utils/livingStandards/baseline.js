// Helpers shared by the baseline sections (living standards, poverty).

import { fyStart } from "./outlook";
import { zeroBasedAxis } from "../chartTheme";
import { CHART_COLOURS } from "../chartTheme";

export const EMPTY = [];

export const OUTTURN_COLOUR = CHART_COLOURS.before;
export const PROJECTION_COLOUR = CHART_COLOURS.after;

/**
 * A short form of a measure or group name for a closed in-card pill, so a
 * card's pills fit one line; the list keeps the full name. "Absolute (BHC)"
 * becomes "Absolute, before housing", "All people" "All".
 */
export function shortLabel(label) {
  const text = String(label);
  const fixed = {
    "All people": "All",
    "All children": "All",
    "Working-age adults": "Working age",
    "Gini coefficient": "Gini",
    "90:10 ratio": "90:10",
    "Cash terms": "Cash",
  };
  if (fixed[text]) return fixed[text];
  const basis = text.match(/^(Absolute|Relative) \((BHC|AHC)\)$/);
  // Plain words, not BHC / AHC
  const housing = (code) => (code === "BHC" ? "before housing" : "after housing");
  if (basis) return `${basis[1]}, ${housing(basis[2])}`;
  const income = text.match(/^(Mean|Median) equivalised income \((BHC|AHC)\)$/);
  if (income) return `${income[1]}, ${housing(income[2])}`;
  return text;
}

export const VIEW_OPTIONS = [
  { value: "outturn", label: "Official figures" },
  { value: "both", label: "Both" },
  { value: "forecast", label: "PolicyEngine" },
];

/**
 * About this chart's line on the two series. The teal line is not a
 * forecast: it is the model for every year drawn, outturn years included.
 */
export const OFFICIAL_VS_PE =
  "Official figures are DWP Households Below Average Income outturn. The teal line is PolicyEngine's microsimulation for every year shown, including years official figures already cover, where the two can differ.";

/** SVG dash patterns, so lines differ by pattern as well as colour. */
export const DASH = {
  solid: undefined,
  long: "8 4",
  dot: "2 4",
  dashDot: "12 4 2 4",
  short: "4 4",
};

export const NO_OFFICIAL_SERIES = "No official series on this definition";

/**
 * First projection year the charts show: the latest HBAI outturn year
 * anywhere in the file (2024-25 with the current data). The model's own point
 * for that year is drawn next to the official one, so the level gap shows
 * within one year instead of as a one-year change; earlier model years are
 * not drawn. Headline changes start at 2027-28 (headlineStartYear).
 */
export function projectionStartYear(data) {
  let last = -Infinity;
  const scan = (rows) => (rows || []).forEach((d) => (last = Math.max(last, fyStart(d.year))));
  Object.values(data?.living_standards?.outturn || {}).forEach(scan);
  Object.values(data?.poverty?.outturn || {}).forEach((byGroup) => Object.values(byGroup || {}).forEach(scan));
  return Number.isFinite(last) ? last : -Infinity;
}

/**
 * Projection rows from startYear to the headline end year (2031-32,
 * meta.headline_end_year).
 */
export const trimProjection = (rows, startYear, endYear = Infinity) =>
  (rows || EMPTY).filter((d) => fyStart(d.year) >= startYear && fyStart(d.year) <= endYear);

/** Last year any model chart draws: meta.headline_end_year, as a number. */
export const chartEndYear = (data) => (data?.meta?.headline_end_year ? fyStart(data.meta.headline_end_year) : Infinity);

/** Merge outturn + projection rows into { year, historical, projection }. */
export function mergeSeries(outturn, projection, pick) {
  const merged = {};
  (outturn || []).forEach((d) => {
    const v = pick(d);
    if (v == null) return;
    const year = fyStart(d.year);
    merged[year] = { ...(merged[year] || { year }), historical: v };
  });
  (projection || []).forEach((d) => {
    const v = pick(d);
    if (v == null) return;
    const year = fyStart(d.year);
    merged[year] = { ...(merged[year] || { year }), projection: v };
  });
  return Object.values(merged).sort((a, b) => a.year - b.year);
}

/** Rows with a value on a visible line, so the x axis spans only what is drawn. */
export function visibleRows(rows, viewMode) {
  return rows.filter(
    (d) =>
      (viewMode !== "forecast" && d.historical != null) || (viewMode !== "outturn" && d.projection != null),
  );
}

export function lineSeries(viewMode, hasOutturn = true) {
  return [
    {
      key: "historical",
      name: "Official figures",
      colour: OUTTURN_COLOUR,
      dash: DASH.solid,
      hidden: viewMode === "forecast" || !hasOutturn,
    },
    {
      key: "projection",
      name: "PolicyEngine",
      colour: PROJECTION_COLOUR,
      // Solid: a dashed line would read as a forecast
      dash: DASH.solid,
      hidden: viewMode === "outturn",
    },
  ];
}

export function legendItemsFor(viewMode, hasOutturn = true) {
  return lineSeries(viewMode, hasOutturn)
    .filter((s) => !s.hidden)
    .map((s) => ({ color: s.colour, label: s.name, type: "line", dash: s.dash }));
}

/**
 * Axis from 0 with about five round steps (1, 2, 2.5 or 5 x 10^n) that clear
 * the data maximum by at least 5%. Returns { domain, ticks }.
 */
export function niceAxis(dataMax) {
  const max = dataMax > 0 ? dataMax * 1.05 : 1;
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const n = Math.ceil(max / step);
  const ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
  return { domain: [0, ticks[n]], ticks };
}

/**
 * Axis over the values with about five round steps, always including 0
 * (the dashboard's rule, chartTheme.zeroBasedAxis): for series that go
 * negative (growth) or sit well above 0 (Gini, 90:10). `includeZero` is
 * kept for callers; 0 is always in. Returns { domain, ticks }.
 */
export function rangeAxis(values, { pad = 0.05 } = {}) {
  return zeroBasedAxis(values, { pad });
}

/** Rows of { year, value } -> chart rows keyed by fiscal-year start. */
export const byYear = (rows, pick = (d) => d.value) =>
  (rows || []).map((d) => ({ year: fyStart(d.year), value: pick(d) }));

/** Join several { year, ... } series into one row per year: { year, [key]: value }. */
export function joinSeries(entries) {
  const out = {};
  entries.forEach(([key, rows, pick]) =>
    (rows || []).forEach((d) => {
      const year = fyStart(d.year);
      const v = pick(d);
      if (v == null) return;
      out[year] = { ...(out[year] || { year }), [key]: v };
    }),
  );
  return Object.values(out).sort((a, b) => a.year - b.year);
}

/**
 * Chart palette (teal ramp + neutral), as the published UK dashboards: the
 * shared chart colours (chartTheme.CHART_COLOURS), so a rise is the gain
 * teal and a fall the loss amber on every tab. `light` is the ramp's third
 * step, for a series beside dark and teal.
 */
export const PALETTE = {
  dark: CHART_COLOURS.highlight,
  teal: CHART_COLOURS.gain,
  light: CHART_COLOURS.gainLight,
  grey: CHART_COLOURS.noChange,
  amber: CHART_COLOURS.loss,
};

// Round steps: 1, 2 or 5 x 10^n, the smallest at least `raw` (no 2.5, so
// a percentage tick never needs a second decimal: 12.5% would read "13%")
const roundStep = (raw) => {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
};

/**
 * An axis fitted to the values, for a level over time (incomes, the Gini, a
 * poverty rate), so a change of a few per cent is visible: the data's range
 * padded by `pad` of itself each side, in about `steps` round steps, never
 * below 0 for values that are not. `broken` is true when the axis does not
 * start at 0, so the chart marks the break. Returns { domain, ticks, broken }.
 */
export function zoomAxis(values, { pad = 0.3, steps = 4 } = {}) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return { domain: [0, 1], ticks: [0, 1], broken: false };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // A flat series still gets a little room either side (5% of its level)
  const span = Math.max(max - min, Math.abs(max) * 0.05, 1e-6);
  let lo = min - span * pad;
  const hi = max + span * pad;
  if (min >= 0) lo = Math.max(0, lo);
  const step = roundStep((hi - lo) / steps);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, broken: ticks[0] > 0 };
}

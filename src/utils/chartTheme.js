/**
 * Shared presentation settings for the dashboard's Recharts charts.
 *
 * Everything here is visual: grid, ticks, margins and legend layout. It never
 * touches the data a chart plots.
 */
import { useEffect, useState } from "react";

// At or below this width (the page's phone breakpoint) a chart tightens its
// margins and puts the PolicyEngine logo under the legend, not beside it.
export const NARROW_QUERY = "(max-width: 768px)";

export function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/**
 * Chart colours by meaning, the same on every tab: the JS mirror of the
 * --c-* tokens in src/app/globals.css (SVG and PNG exports need literal
 * values, so charts take these rather than var(--c-*)). chartTheme.test.js
 * keeps the two equal. Policy colours come from measureCatalogue.jsx.
 */
export const CHART_COLOURS = {
  gain: "#319795",
  gainText: "#0F766E",
  loss: "#D97706",
  lossText: "#B45309",
  lossSoft: "#FDF0E1",
  lossBorder: "#FDE68A",
  noChange: "#9CA3AF",
  before: "#9CA3AF",
  after: "#319795",
  reference: "#6B7280",
  highlight: "#285E61",
  highlightBand: "#EAF5F4",
  hover: "#EEF6F6",
  obr: "#9CA3AF",
  obrText: "#6B7280",
  net: "#000000",
  zeroLine: "#374151",
  grid: "#E5E7EB",
  axis: "#D1D5DB",
  tick: "#6B7280",
  axisTitle: "#4B5563",
  text: "#374151",
  surface: "#FFFFFF",
  mutedFill: "#F3F4F6",
  diffSmall: "#10B981",
  diffMedium: "#FBBF24",
  diffLarge: "#EF4444",
  ageChildren: "#8DB8E3",
  ageYoungAdults: "#5A8FCB",
  ageAdults: "#3165A8",
  ageOlder: "#7C5CB8",
  agePension: "#2E1F5E",
  marketIncome: "#4A7BA7",
  pensionContributions: "#B8875A",
  gainLight: "#81E6D9",
  lossLight: "#FBBF24",
  ink: "#1F2937",
  noticeBg: "#FFF7E6",
  noticeText: "#7A5A1F",
  mtrIncomeTax: "#5FB3A8",
  mtrChildBenefit: "#4FD1C5",
  mtrAllowanceTaper: "#285E61",
  mtrNationalInsurance: "#A7E3DA",
  mtrStudentLoan: "#E8B66A",
  mtrUniversalCredit: "#2F855A",
  mtrOtherBenefits: "#9AE6B4",
  mtrOther: "#D1D5DB",
  // The net income card's layers the marginal rate card has not: benefits
  // in greens, the household's other taxes in purples
  netStatePension: "#22543D",
  netWarmHomeDiscount: "#68D391",
  netCouncilTax: "#8E7CC3",
  netFuelDuty: "#553C9A",
  netVat: "#B794F4",
};

/**
 * The measures' colour ramps, one per group: Raise revenue in ambers (browns),
 * Cost revenue in teals, each running darkest to lightest. A group's
 * measures take its ramp in order of size (largest darkest), so a stack,
 * its legend and its tooltip shade monotonically. The JS mirror of the
 * --ramp-* tokens in src/app/globals.css (chartTheme.test.js keeps the two
 * equal). The catalogue samples them for any number of measures (measureRamp, below).
 */
export const POLICY_RAMPS = {
  // Amber 900, 700, 500
  raise: ["#78350F", "#B45309", "#F59E0B"],
  // Teals, dark blue-teal to mint: the hue turns as the steps lighten, so
  // the dark end stays apart (seven steps do not fit at 3:1 on white; the
  // lightest is 1.75:1)
  cost: ["#0D4359", "#016768", "#088075", "#00997F", "#28B084", "#4AC685", "#75D987"],
};

/**
 * How the measure catalogue (measureCatalogue.jsx, #104) colours the
 * published measures: each direction's measures, ranked by budgetary size
 * (largest first), take evenly spaced steps along that direction's ramp
 * above, darkest first, so any number of measures get distinct shades.
 * Revenue-raising measures take the raise ramp (ambers), those that cost
 * revenue the cost ramp (teals), and a measure with no published costing
 * the no-change grey. With more than `alternateAbove` measures in one
 * direction, every second step turns its hue by `hue` degrees and scales
 * its chroma by `chroma` (cost: blue-teal; revenue: brown), at the same
 * lightness, so neighbours in a stack stay apart. Numbers, not colours: the
 * colours are the POLICY_RAMPS tokens.
 */
export const MEASURE_RAMPS = Object.freeze({
  cost: Object.freeze({ stops: POLICY_RAMPS.cost, hue: 25, chroma: 1 }),
  revenue: Object.freeze({ stops: POLICY_RAMPS.raise, hue: -8, chroma: 0.6 }),
  alternateAbove: 8,
  neutral: CHART_COLOURS.noChange,
});

// sRGB <-> OKLab (Björn Ottosson's matrices), for even perceptual steps
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A hex colour as OKLab [L, a, b]. */
export function hexToOklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** An OKLab colour as hex; out of the sRGB gamut, chroma is reduced (lightness and hue kept). */
function oklabToHex([L, a0, b0]) {
  let [a, b] = [a0, b0];
  for (let k = 0; k < 60; k += 1) {
    if (oklabToLinearRgb([L, a, b]).every((v) => v >= -1e-4 && v <= 1 + 1e-4)) break;
    a *= 0.95;
    b *= 0.95;
  }
  return rgbToHex(oklabToLinearRgb([L, a, b]).map((v) => fromLinear(Math.min(1, Math.max(0, v))) * 255));
}

/**
 * `n` colours for one direction's measures, largest first: evenly spaced in
 * OKLab along the direction's ramp (by distance along it), from its darkest
 * stop to its lightest, with every second step turned in hue when n is over
 * MEASURE_RAMPS.alternateAbove. A neutral direction gives the grey.
 */
export function measureRamp(direction, n) {
  const ramp = MEASURE_RAMPS[direction];
  if (!ramp?.stops) return Array.from({ length: n }, () => MEASURE_RAMPS.neutral);
  const labs = ramp.stops.map(hexToOklab);
  const lengths = labs.slice(1).map((lab, i) => Math.hypot(...lab.map((v, k) => v - labs[i][k])));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const alternate = n > MEASURE_RAMPS.alternateAbove;
  return Array.from({ length: n }, (_, i) => {
    let along = n === 1 ? 0 : (i / (n - 1)) * total;
    let k = 0;
    while (k < lengths.length - 1 && along > lengths[k]) {
      along -= lengths[k];
      k += 1;
    }
    const f = lengths[k] ? Math.min(1, along / lengths[k]) : 0;
    let [L, a, b] = labs[k].map((v, j) => v + (labs[k + 1][j] - v) * f);
    if (alternate && i % 2 === 1) {
      const chroma = Math.hypot(a, b) * ramp.chroma;
      const hue = Math.atan2(b, a) + (ramp.hue * Math.PI) / 180;
      [a, b] = [chroma * Math.cos(hue), chroma * Math.sin(hue)];
    }
    return oklabToHex([L, a, b]);
  });
}

/**
 * Income groups from the lowest-income to the highest-income end: a
 * diverging ramp, amber (low) through a grey midpoint to teal (high), each
 * arm darkest at its end. The JS mirror of the --income-ramp-* tokens in
 * src/app/globals.css (chartTheme.test.js keeps the two equal).
 * incomeGroupColours samples it for any number of groups.
 */
export const INCOME_RAMP = ["#8A3A0C", "#B8641C", "#E0954A", "#9CA3AF", "#5FB3AA", "#2A8C84", "#0F5F59"];

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * `n` colours along INCOME_RAMP, evenly spaced from its low-income end to its
 * high-income end (an odd count puts the middle group on the grey midpoint),
 * interpolated between neighbouring stops.
 */
export function incomeGroupColours(n) {
  if (n <= 1) return [INCOME_RAMP[INCOME_RAMP.length - 1]];
  const last = INCOME_RAMP.length - 1;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * last;
    const lo = Math.min(Math.floor(t), last - 1);
    const f = t - lo;
    const [a, b] = [hexToRgb(INCOME_RAMP[lo]), hexToRgb(INCOME_RAMP[lo + 1])];
    return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
  });
}

/**
 * Names ordered by size, largest first: the mean absolute value over the
 * points given (a point marked `unpublished` is left out). Ties keep the
 * order given.
 *
 * @param {string[]} names
 * @param {Array<Object>} points - One object per year, keyed by name
 */
export function orderBySize(names, points) {
  const shown = points.filter((point) => !point.unpublished);
  const size = (name) =>
    shown.length === 0
      ? 0
      : shown.reduce((sum, point) => sum + Math.abs(Number(point[name]) || 0), 0) / shown.length;
  return names
    .map((name, index) => ({ name, index, size: size(name) }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .map(({ name }) => name);
}

// Light horizontal gridlines only.
/** "Before" is a grey dashed line on every chart, "after" a teal solid one */
export const BEFORE_DASH = "6 4";

/** A reference line or series (all people, all ages, "You"): one dashed style */
export const REFERENCE_DASH = "4 3";

/**
 * The selected year (or group) is drawn at full strength, the others at
 * this opacity, in the same colour: a tint, not a different colour.
 */
export const UNSELECTED_OPACITY = 0.5;

/** The hover cursor behind a bar or row, on every chart */
export const HOVER_CURSOR = { fill: CHART_COLOURS.hover };

export const GRID_PROPS = {
  vertical: false,
  stroke: CHART_COLOURS.grid,
  strokeDasharray: "0",
};

export const TICK_STYLE = { fontSize: 12, fill: CHART_COLOURS.tick };
export const AXIS_LINE = { stroke: CHART_COLOURS.axis };

export const AXIS_TITLE_STYLE = {
  textAnchor: "middle",
  fill: CHART_COLOURS.axisTitle,
  fontSize: 12,
  fontWeight: 500,
};

/**
 * Width kept at the left of a YAxis for its rotated title (ChartUnitLabel),
 * left of the tick labels.
 */
export const Y_TITLE_GUTTER = 18;

/**
 * Chart margins: the plot spans the card's width. The y-axis title is
 * rotated in the YAxis's own gutter (axisWidth), so the left margin is 0;
 * the top margin only keeps the top tick label inside the chart.
 */
export function chartMargin(narrow, { top } = {}) {
  return { top: top ?? 10, right: 8, left: 0, bottom: 0 };
}

/**
 * A YAxis width that fits its longest tick label (12px text), plus the
 * gutter for the rotated y-axis title (pass { title: false } without one).
 */
export function axisWidth(ticks, format = String, { title = true } = {}) {
  const longest = Math.max(...ticks.map((tick) => format(tick).length), 1);
  return Math.ceil(longest * 7) + 10 + (title ? Y_TITLE_GUTTER : 0);
}

/**
 * Legend wrapper: the full chart width, centred, with a row kept free below
 * it for the PolicyEngine logo (drawn at the bottom right), so the logo
 * never pushes the legend off centre.
 */
export function legendWrapperStyle(narrow) {
  return {
    left: 0,
    width: "100%",
    boxSizing: "border-box",
    paddingTop: narrow ? 12 : 16,
    paddingBottom: 30,
    lineHeight: narrow ? "20px" : "22px",
  };
}

export function legendLabelStyle(narrow) {
  return {
    color: CHART_COLOURS.text,
    fontSize: narrow ? "12px" : "13px",
    fontWeight: 400,
  };
}

export const TOOLTIP_CONTENT_STYLE = {
  background: CHART_COLOURS.surface,
  border: `1px solid ${CHART_COLOURS.grid}`,
  borderRadius: "6px",
  boxShadow: "0 4px 12px var(--shadow-soft)",
  fontSize: "13px",
};

/** Short fiscal year label for a phone axis: 2026 -> "26–27". */
export function shortFiscalYearTick(year) {
  const y = Number(year);
  return `${String(y).slice(-2)}\u2013${String(y + 1).slice(-2)}`;
}

/** Fiscal year label: 2026 -> "2026-27". */
export function fiscalYearTick(year) {
  const y = Number(year);
  return `${y}-${(y + 1).toString().slice(-2)}`;
}

/**
 * Every y axis on the dashboard includes 0: an axis over
 * [min(0, data min), max(0, data max)] with about five round steps (1, 2,
 * 2.5 or 5 x 10^n), padded by `pad` of the span on the side away from 0,
 * so a small move is never drawn as a large one. Where values go negative,
 * 0 stays inside the axis. Returns { domain, ticks }.
 */
export function zeroBasedAxis(values, { pad = 0.05 } = {}) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  if (lo < 0) lo -= span * pad;
  if (hi > 0 || lo === 0) hi += span * pad;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

// Round steps: 1, 2, 2.5 or 5 x 10^n, the smallest at least `raw`
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

/**
 * An axis symmetric about 0, for values on both sides of it: ±m, where m is
 * the largest absolute value padded by `pad` and rounded up to a round step
 * (about two or three ticks a side), so 0 sits in the middle and a rise and
 * a fall of the same size are drawn the same length. Returns { domain, ticks }.
 */
export function symmetricAxis(values, { pad = 0.05 } = {}) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  const largest = Math.max(0, ...vals.map(Math.abs)) * (1 + pad) || 1;
  const step = niceStep(largest / 2.5);
  const end = Math.ceil(largest / step - 1e-9) * step;
  const ticks = [];
  for (let v = -end; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6 || 0);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * The y axis of a chart that can diverge from 0 (changes, gains and
 * costs): symmetric about 0 (symmetricAxis) when the values fall on both
 * sides of it, otherwise from 0 (zeroBasedAxis), so a chart whose values
 * are all one sign is not drawn half empty.
 */
export function divergingAxis(values, options) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  const both = vals.some((v) => v > 1e-9) && vals.some((v) => v < -1e-9);
  return both ? symmetricAxis(vals, options) : zeroBasedAxis(vals, options);
}

/**
 * The x axis of a salary sweep: from £0 to exactly the sweep's last point,
 * so no axis runs past the data, with ticks at a round step inside it
 * (£0, £50k … £200k for a sweep to £225k). Every chart of one sweep takes
 * the same axis, so its "You" line sits at the same place in each.
 *
 * @param {number} max - The sweep's last point
 * @returns {{domain: [number, number], ticks: number[]}}
 */
export function sweepAxis(max) {
  const steps = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000];
  const top = max > 0 ? max : 1;
  const step = steps.find((candidate) => top / candidate <= 5) ?? steps[steps.length - 1];
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(value);
  return { domain: [0, top], ticks };
}

// Width a full fiscal-year tick ("2027-28") needs at 12px, with a gap
const FISCAL_TICK_WIDTH = 64;

/**
 * Fiscal-year ticks that fit the plot: the full "2027-28" label, every
 * year if there is room, otherwise every second or third year counted from
 * `base` (the base year, 2027-28, is always a tick when given), and always
 * the first and last year. A tick too close to the first or last is
 * dropped, so labels never touch. The tooltip still names every year.
 * Returns the years to label (for Recharts' `ticks`).
 */
export function fiscalYearTicks(years, plotWidth, { base } = {}) {
  const list = [...years];
  if (list.length <= 2 || !plotWidth) return list;
  const per = plotWidth / list.length;
  const step = Math.max(1, Math.ceil(FISCAL_TICK_WIDTH / per));
  if (step === 1) return list;
  const anchor = list.includes(base) ? list.indexOf(base) : 0;
  const first = 0;
  const last = list.length - 1;
  const picked = new Set([first, last]);
  for (let i = 0; i < list.length; i += 1) {
    if ((i - anchor) % step !== 0) continue;
    // Keep clear of the first and last, which are always shown
    if (i !== first && i - first < step) continue;
    if (i !== last && last - i < step) continue;
    picked.add(i);
  }
  return [...picked].sort((a, b) => a - b).map((i) => list[i]);
}

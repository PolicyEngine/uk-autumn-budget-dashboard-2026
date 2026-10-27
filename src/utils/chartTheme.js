/**
 * Shared presentation settings for the dashboard's Recharts charts.
 *
 * Everything here is visual: grid, ticks, margins and legend layout. It never
 * touches the data a chart plots.
 */
import { createElement, useEffect, useState } from "react";
import { CHART_LOGO } from "./chartLogo";

// At or below this width (the page's phone breakpoint) a chart tightens its
// margins and puts the PolicyEngine logo under the legend, not beside it.
export const NARROW_QUERY = "(max-width: 768px)";

export function useNarrowViewport() {
  return useViewportMatch(NARROW_QUERY);
}

// A phone's width: below this a chart drops the labels it cannot fit and
// says the same in its sentence
export const PHONE_QUERY = "(max-width: 480px)";

/** Whether the window matches a media query, false before the page is in the browser. */
export function useViewportMatch(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
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
  lossSoft: "#FEF4E8",
  lossBorder: "#FDE68A",
  noChange: "#9CA3AF",
  before: "#9CA3AF",
  after: "#319795",
  reference: "#6B7280",
  highlight: "#285E61",
  highlightBand: "#EAF5F4",
  tenthBand: "#DDE6F3",
  hover: "#EEF6F6",
  rowBand: "#F9FAFB",
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
  mapGain: "#14B8A6",
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

/** Gridlines: light and dashed, behind every chart */
export const GRID_PROPS = {
  vertical: false,
  stroke: CHART_COLOURS.grid,
  strokeDasharray: "3 4",
};

// One bar style for the dashboard: rounded outer ends, flush inner joins
// with a small gap between stacked segments.
/** The radius of a bar's outer end, in px (capped at half its thickness) */
export const BAR_RADIUS = 5;
// A chart row's band: the zebra and hover bands of the per-policy row
// charts (the --row-radius token)
export const ROW_RADIUS = 6;
/** The gap between two stacked segments, in px */
export const BAR_GAP = 1.5;

/**
 * An SVG path for a rectangle with its own radius at each corner, in the
 * order top-left, top-right, bottom-right, bottom-left.
 */
export function roundedRectPath(x, y, width, height, [tl, tr, br, bl]) {
  const w = Math.max(width, 0);
  const h = Math.max(height, 0);
  const cap = (r) => Math.max(0, Math.min(r, w / 2, h / 2));
  const [a, b, c, d] = [cap(tl), cap(tr), cap(br), cap(bl)];
  return [
    `M${x + a},${y}`,
    `H${x + w - b}`,
    b ? `A${b},${b} 0 0 1 ${x + w},${y + b}` : "",
    `V${y + h - c}`,
    c ? `A${c},${c} 0 0 1 ${x + w - c},${y + h}` : "",
    `H${x + d}`,
    d ? `A${d},${d} 0 0 1 ${x},${y + h - d}` : "",
    `V${y + a}`,
    a ? `A${a},${a} 0 0 1 ${x + a},${y}` : "",
    "Z",
  ].join("");
}

const segmentValue = (payload, key) => {
  const value = Number(payload?.[key]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * A Recharts <Bar shape> in the dashboard's bar style. `keys` are the
 * stack's dataKeys in the order the <Bar>s are drawn (one key for a plain
 * bar). Each segment that ends its stack on its side of zero gets a
 * rounded outer end; a segment followed by another of the same sign is cut
 * short by BAR_GAP, so the joins read as separate and stay flush. With
 * `roundBase` (a 100% bar, which has no zero line to sit on) the first
 * segment's start is rounded too.
 *
 * @param {string[]} keys
 * @param {{layout?: "horizontal"|"vertical", roundBase?: boolean, radius?: number}} [options]
 *   `layout` as the chart's: "horizontal" for upright bars, "vertical" for
 *   bars running across.
 */
export function barShape(keys, { layout = "horizontal", roundBase = false, radius = BAR_RADIUS } = {}) {
  return function BarShape(props) {
    const { x, y, width, height, fill, fillOpacity, opacity, payload, dataKey, value } = props;
    if (![x, y, width, height].every(Number.isFinite) || (width === 0 && height === 0)) return null;
    // The sign from the data (a stacked value's range is always low to high)
    const raw = Number(payload?.[dataKey]);
    const own = Number.isFinite(raw) ? raw : Array.isArray(value) ? value[1] - value[0] : Number(value) || 0;
    const sign = own < 0 ? -1 : 1;
    const index = keys.indexOf(dataKey);
    const sameSign = (key) => {
      const other = segmentValue(payload, key);
      return other !== 0 && Math.sign(other) === sign;
    };
    const outer = index < 0 || !keys.slice(index + 1).some(sameSign);
    const first = index < 0 || !keys.slice(0, index).some(sameSign);
    const across = layout === "vertical";
    let x0 = Math.min(x, x + width);
    let y0 = Math.min(y, y + height);
    let w = Math.abs(width);
    let h = Math.abs(height);
    // Cut a segment short at its outer side when another follows it (at
    // most a third of it, so a thin segment still shows)
    if (!outer) {
      if (across) {
        const cut = Math.min(BAR_GAP, w / 3);
        w -= cut;
        if (sign < 0) x0 += cut;
      } else {
        const cut = Math.min(BAR_GAP, h / 3);
        h -= cut;
        if (sign > 0) y0 += cut;
      }
    }
    const r = (on) => (on ? radius : 0);
    const end = outer;
    const base = roundBase && first;
    // Corners: top-left, top-right, bottom-right, bottom-left
    let corners;
    if (across) {
      const right = sign > 0 ? end : base;
      const left = sign > 0 ? base : end;
      corners = [r(left), r(right), r(right), r(left)];
    } else {
      const top = sign > 0 ? end : base;
      const bottom = sign > 0 ? base : end;
      corners = [r(top), r(top), r(bottom), r(bottom)];
    }
    return createElement("path", {
      className: "recharts-rectangle",
      d: roundedRectPath(x0, y0, w, h, corners),
      fill,
      fillOpacity,
      opacity,
    });
  };
}

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
export const Y_TITLE_GUTTER = 22;

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

/** Height kept free under a legend: the logo, its padding and its clear space above. */
export function logoClearance() {
  return (CHART_LOGO.gap ?? 16) + CHART_LOGO.height + (CHART_LOGO.padding ?? 8);
}

/**
 * Legend wrapper: the full chart width, centred, with a row kept free below
 * it for the PolicyEngine logo (drawn at the bottom right), so the logo
 * never pushes the legend off centre, with CHART_LOGO.gap of clear space
 * between the legend's last row and the logo.
 */
export function legendWrapperStyle(narrow) {
  return {
    left: 0,
    width: "100%",
    boxSizing: "border-box",
    paddingTop: narrow ? 12 : 16,
    // The logo row, with clear space above it (CHART_LOGO.gap)
    paddingBottom: logoClearance(),
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

// The largest round step (1, 2, 2.5 or 5 x 10^n) no bigger than `raw`
function niceStepBelow(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [10, 5, 2.5, 2, 1].map((m) => m * mag).find((s) => s <= raw * (1 + 1e-9));
}

/**
 * An axis fitted to the data on each side of 0, never forced symmetric:
 * [min(0, data min), max(0, data max)] padded by `pad` of each end, with
 * ticks at a round step (about four to eight of them, always 0) and each
 * end rounded out to half that step. Data from −0.46 to +0.13 gives
 * −0.5 to +0.15 with ticks every 0.1. Returns { domain, ticks }.
 */
export function fittedAxis(values, { pad = 0.08 } = {}) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  const lo = Math.min(0, ...vals) * (1 + pad);
  const hi = Math.max(0, ...vals) * (1 + pad);
  if (hi - lo < 1e-12) return zeroBasedAxis(vals);
  const step = niceStepBelow((hi - lo) / 4);
  // Ends on half steps where that is itself round (0.05 for 0.1 ticks;
  // never 1.25 for 2.5 ticks)
  const mantissa = Math.round(step / 10 ** Math.floor(Math.log10(step)) * 10) / 10;
  const grain = mantissa === 2.5 ? step : step / 2;
  const clean = (v) => Math.round(v * 1e9) / 1e9 || 0;
  const domain = [clean(Math.floor(lo / grain + 1e-9) * grain), clean(Math.ceil(hi / grain - 1e-9) * grain)];
  const ticks = [];
  for (let k = Math.ceil(domain[0] / step - 1e-9); k <= Math.floor(domain[1] / step + 1e-9); k += 1) ticks.push(clean(k * step));
  return { domain, ticks };
}

/**
 * The y axis of a chart that can diverge from 0 (changes, gains and
 * costs): fitted to each side (fittedAxis) when the values fall on both
 * sides of 0, so a small rise beside a large fall is not drawn in a half
 * empty plot; otherwise from 0 (zeroBasedAxis).
 */
export function divergingAxis(values, options) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  const both = vals.some((v) => v > 1e-9) && vals.some((v) => v < -1e-9);
  return both ? fittedAxis(vals, options) : zeroBasedAxis(vals, options);
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

/** Text width without a canvas: close enough for 12–13px system sans. */
export const approxTextWidth = (text, fontSize = 12) => String(text).length * fontSize * 0.56;

// One canvas for measuring tick labels in the page's own font
let measureContext;
/**
 * A label's width in px in the page's font, measured on a canvas in a
 * browser ("−£250" is wider than its five characters suggest); the
 * estimate (approxTextWidth) on the server and in tests.
 */
export function tickTextWidth(text, fontSize = 12) {
  if (typeof document === "undefined" || /jsdom/i.test(globalThis.navigator?.userAgent ?? "")) {
    return approxTextWidth(text, fontSize);
  }
  if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d") ?? null;
  if (!measureContext) return approxTextWidth(text, fontSize);
  measureContext.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
  return measureContext.measureText(String(text)).width;
}

// Round multipliers (1, 2 or 5 x 10^n; 2.5 is never a whole number of
// steps): a thinned axis labels every second, fifth or tenth tick
const isRound = (value) => {
  const mantissa = value / 10 ** Math.floor(Math.log10(value) + 1e-9);
  return [1, 2, 2.5, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6);
};

/**
 * The tick labels that fit a plot `plotWidth` px wide: from the round
 * `ticks` (an even step over `domain`), every tick if the labels clear one
 * another by `minGap` px, otherwise every second, fifth … (a round step,
 * 0 always kept), so "−£200 £0 £200 £400 £600 £800" in a narrow plot
 * becomes "−£200 £0 £400 £800". An end of the domain off the coarser step
 * keeps its label only where it, too, clears its neighbour. Labels are
 * centred on their tick, or, with `inside`, the first starts at its tick
 * and the last ends at its tick. `keep` (0 unless given, as 100 on a % of
 * the official costing axis) is always labelled where it is a tick.
 * Unmeasured (plotWidth 0), every tick.
 *
 * @param {number[]} ticks - Round ticks at one step, ascending
 * @param {[number, number]} domain - The axis's ends
 * @param {number} plotWidth - The plot's width in px
 * @param {(tick: number) => string} format - A tick's label
 * @returns {number[]} The ticks to label (and draw a gridline at)
 */
export function fitTicks(ticks, domain, plotWidth, format, { minGap = 12, fontSize = 12, inside = false, keep = 0 } = {}) {
  if (!plotWidth || ticks.length < 2) return ticks;
  const [lo, hi] = domain;
  const x = (value) => ((value - lo) / (hi - lo || 1)) * plotWidth;
  const width = (value) => tickTextWidth(format(value), fontSize);
  // A label's [left, right] in px
  const extent = (value, index, count) => {
    const w = width(value);
    if (inside && index === 0 && value === ticks[0]) return [x(value), x(value) + w];
    if (inside && index === count - 1 && value === ticks[ticks.length - 1]) return [x(value) - w, x(value)];
    return [x(value) - w / 2, x(value) + w / 2];
  };
  const fits = (list) =>
    list.every((value, i) => i === 0 || extent(value, i, list.length)[0] - extent(list[i - 1], i - 1, list.length)[1] >= minGap);
  const step = ticks[1] - ticks[0];
  const anchor = ticks.find((tick) => Math.abs(tick - keep) < 1e-9) ?? ticks[0];
  // The domain's ends, where they clear their neighbours
  const withEnds = (kept) => {
    let labelled = kept;
    for (const end of [ticks[0], ticks[ticks.length - 1]]) {
      if (labelled.includes(end)) continue;
      const withEnd = [...labelled, end].sort((a, b) => a - b);
      if (fits(withEnd)) labelled = withEnd;
    }
    return labelled;
  };
  for (let m = 1; m < ticks.length; m += 1) {
    if (!isRound(m)) continue;
    const kept = ticks.filter((tick) => {
      const k = (tick - anchor) / (step * m);
      return Math.abs(k - Math.round(k)) < 1e-6;
    });
    if (fits(kept)) return withEnds(kept);
  }
  // No round step fits: the kept tick, and an end if it clears it
  return withEnds([anchor]);
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

/**
 * The fewest decimal places, from `min` to `max`, at which every tick reads
 * differently: 1 for ticks 0.1 apart, 2 for ticks 0.02 apart. A small axis
 * (one measure's change in net income, in %) otherwise repeats labels, such
 * as "0.0%, 0.0%, 0.1%, 0.1%".
 */
export function tickDecimals(ticks, min = 0, max = 3) {
  for (let decimals = min; decimals < max; decimals += 1) {
    const shown = new Set(ticks.map((tick) => Number(tick.toFixed(decimals))));
    if (shown.size === ticks.length) return decimals;
  }
  return max;
}

/** A number to `decimals` places, never "-0.0": a value that rounds to zero has no sign. */
export function fixedNoNegativeZero(value, decimals) {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

/**
 * In place of a plot whose selected policies change no household's income
 * in the year shown (an employer cost alone): "None of the selected
 * policies changes household incomes in 2027-28."
 */
export const noHouseholdChange = (yearText) =>
  `None of the selected policies changes household incomes in ${yearText}.`;

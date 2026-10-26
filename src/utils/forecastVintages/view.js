// The OBR forecasts view's chart, as data: for one variable, unit and
// frequency, the outturn and every forecast in the unit shown, the rows
// the chart plots, and the labelled start, latest and end points. Reads
// public/data/obr_forecast_vintages.json (load.js); shape in
// data_inputs/forecast_vintages/README.md.

import {
  annualSums,
  annualise,
  anchorFor,
  carryForward,
  firstIndex,
  from,
  lastIndex,
  lastWholeYear,
  pctChange,
  periodIndex,
  periodLabel,
  splice,
  toIndex,
  toSeries,
  whole,
} from "./transforms";

const gb = (digits) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The unit pills a variable offers, in the page's order. */
export const UNIT_ORDER = ["level", "index", "pct"];

/**
 * Levels for one measure: the outturn and each forecast carried on from
 * it, at the variable's own frequency or (annual, for a quarterly
 * variable) as calendar-year totals. A forecast that cannot be carried on
 * (no outturn where it starts, or too few whole years) is in `undrawn`,
 * by label, not left out unsaid.
 */
export function measureLevels(variable, measure, { annual = false } = {}) {
  const frequency = variable.frequency;
  const lag = frequency === "quarterly" ? 4 : 1;
  const outturn = toSeries(measure.outturn, frequency);
  const outturnEnd = lastIndex(outturn);
  const count = measure.vintages.length;
  const undrawn = [];
  const vintages = [];
  measure.vintages.forEach((vintage, i) => {
    const values = toSeries(vintage.values, frequency);
    const launch = periodIndex(vintage.launch, frequency);
    const anchor = anchorFor({
      kind: measure.kind,
      launch,
      newest: i === count - 1,
      outturnEnd,
      forecastEnd: lastIndex(values),
    });
    const levels = carryForward(measure.kind, values, outturn, anchor, { lag });
    // reanchored: drawn from a later period than its launch (the newest)
    if (levels) vintages.push({ id: vintage.id, label: vintage.label, anchor, reanchored: anchor !== launch, levels, own: measure.kind === "level" });
    else undrawn.push(vintage.label);
  });
  if (!annual) return { frequency, outturn, vintages, undrawn };
  const yearly = [];
  for (const v of vintages) {
    const start = lastWholeYear(v.anchor);
    const levels = from(annualSums(splice(outturn, v.levels, v.anchor)), start);
    if (levels.size > 1) yearly.push({ ...v, anchor: start, levels });
    else undrawn.push(v.label);
  }
  return { frequency: "calendar", outturn: annualSums(outturn), vintages: yearly, undrawn };
}

/** The measures in the chosen unit; null where the unit cannot be drawn. */
export function inUnit(variable, unit, levels, { annual = false, start } = {}) {
  const spec = variable.units[unit];
  const { outturn, vintages } = levels;
  const map = (f) => ({ ...levels, outturn: f(outturn, null), vintages: vintages.map((v) => ({ ...v, values: f(v.levels, v) })) });
  if (unit === "level") {
    return spec.annualise && !annual ? map((s) => annualise(s)) : map((s) => s);
  }
  if (unit === "index") {
    // An index of a value that is not above zero would turn the line over
    const base = outturn.get(start);
    if (!(base > 0)) return null;
    return map((s) => toIndex(s, base));
  }
  // A rate or share (unemployment, debt as a share of GDP) is shown as
  // published; only a unit marked as growth is a % change
  if (spec.transform !== "growth") return map((s) => s);
  // % change on a year earlier: a forecast's first change is on the
  // outturn, unless it is a level drawn as published. Each line has a
  // change at every period from a year into the values it is taken on
  // (and, for a forecast carried on from the outturn, from its anchor) to
  // its last, or none: a value at or below zero, on which no change can
  // be taken, never cuts a line short
  const lag = levels.frequency === "quarterly" ? 4 : 1;
  return map((s, v) => {
    const carried = Boolean(v && !v.own);
    const on = carried ? splice(outturn, s, v.anchor) : s;
    if (!on.size) return new Map();
    const first = Math.max(firstIndex(on) + lag, carried ? v.anchor : -Infinity);
    return whole(from(pctChange(on, lag), first), first, lastIndex(on));
  });
}

/** Formats a value in the unit shown: (value, digits?) -> text. */
export function formatterFor(variable, unit, measure) {
  const spec = variable.units[unit];
  const n = (v, d) => gb(d).format(v);
  if (unit === "index") return (v, d = 1) => n(v, d);
  if (unit === "pct") return (v, d = 1) => `${n(v, d)}%`;
  const u = measure.unit;
  // A sign goes before the pound sign: -£23.6bn
  const pounds = (v, d, suffix = "") => {
    const text = n(v, d);
    return text.startsWith("-") ? `-£${text.slice(1)}${suffix}` : `£${text}${suffix}`;
  };
  if (spec.annualise || u.startsWith("£ a") || u.startsWith("£ av") || u.startsWith("£ per")) return (v) => pounds(v, 0);
  if (u.startsWith("£ billion")) return (v, d = measure.decimals) => pounds(v, d, "bn");
  if (u === "million people") return (v, d = measure.decimals) => `${n(v, d)}m`;
  if (u.startsWith("%")) return (v, d = 1) => `${n(v, d)}%`;
  return (v, d = measure.decimals) => n(v, d);
}

/**
 * Round y-axis ticks over [lo, hi]: about five steps of 1, 2, 2.5 or 5 x
 * 10^n. With `zero`, 0 is kept inside the axis. Null where no axis can be
 * stepped over them (an end not finite, or a span too large to hold),
 * never an axis that does not cover them.
 */
export function niceAxis(lo, hi, { zero = false } = {}) {
  let a = zero ? Math.min(0, lo) : lo;
  let b = zero ? Math.max(0, hi) : hi;
  if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(b - a)) || a > b) return null;
  // A span too small to step through (or none) is widened around it
  if (b - a <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) {
    const pad = Math.max(Math.abs(a), Math.abs(b)) * 0.05 || 1;
    a -= Math.max(pad, 1e-6);
    b += Math.max(pad, 1e-6);
  }
  const raw = (b - a) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  if (!(step > 0 && Number.isFinite(step))) return null;
  // Ticks are counted in whole steps, so every one is a new value and the
  // count is bounded: a step at least a fifth of the span gives at most
  // seven, and the rounding fixes below add at most one at each end
  const at = (i) => Number((i * step).toPrecision(12));
  let first = Math.floor(a / step);
  let last = Math.ceil(b / step);
  // Rounding can leave an end just inside the data
  if (at(first) > a) first -= 1;
  if (at(last) < b) last += 1;
  const ticks = [];
  for (let i = first; i <= last; i += 1) ticks.push(at(i));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, step };
}

/**
 * Decimals a tick step needs: 2.5 -> 1, 0.25 -> 2, 50 -> 0, 5e-7 -> 7. To
 * a billionth of the step itself, so a step finer than any fixed
 * tolerance still gets its decimals, and no tick but 0 is written "0".
 */
export function stepDecimals(step) {
  for (let d = 0; d < 20; d += 1) {
    const scaled = step * 10 ** d;
    const whole = Math.round(scaled);
    if (whole !== 0 && Math.abs(whole - scaled) <= 1e-9 * Math.abs(scaled)) return d;
  }
  return 20;
}

/**
 * A check's figure as text: to two decimals below 10 and one above, or to
 * two significant figures where that is finer, so no figure but zero is
 * written "0". `up` rounds up, so a bound written is still a bound (to
 * the twelve figures it is read to).
 */
function checkFigure(written, { up = false } = {}) {
  // To twelve figures, so 0.0047 * 100, held as 0.47000000000000003, is
  // the 0.47 it was written as, not taken up to 0.48
  const value = Number(written.toPrecision(12));
  if (value === 0) return "0";
  const decimals = Math.max(value < 10 ? 2 : 1, 1 - Math.floor(Math.log10(value)));
  const scale = 10 ** decimals;
  let rounded = Math.round(value * scale) / scale;
  if (up && rounded < value) rounded += 1 / scale;
  return gb(decimals).format(rounded).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** An amount in a check's units: "0.3 percentage points", "£2.1 billion", "2,700 people". */
function checkAmount(value, units, { up = false } = {}) {
  if (units === "million people" && value < 0.1) return `${checkFigure(value * 1e6, { up })} people`;
  const n = checkFigure(value, { up });
  if (units.startsWith("%")) return `${n} percentage point${n === "1" ? "" : "s"}`;
  if (units === "£ billion") return `£${n} billion`;
  if (units === "million people") return `${n} million people`;
  return `${n} (${units})`;
}

/**
 * What the build checked a measure's ONS outturn against, in a sentence:
 * the periods, the tolerance every one is within, and the largest gap
 * (largest relative to the value where the tolerance is a share of it).
 */
export function checkSentence(check, frequency) {
  if (!check?.periods?.length) return null;
  const label = (key) => periodLabel(periodIndex(key, frequency), frequency);
  const share = Boolean(check.tolerance_is_share);
  // The tolerance rounded up: every gap is within it, so within that too
  const tolerance = share
    ? `${checkFigure(check.tolerance * 100, { up: true })}% of the value`
    : checkAmount(check.tolerance, check.in, { up: true });
  const first = label(check.periods[0]);
  const last = label(check.periods[check.periods.length - 1]);
  const gap = checkAmount(Math.abs(check.largest_gap), check.in);
  const what = check.in.startsWith("% change") ? `ONS outturn's ${check.in}` : "ONS outturn";
  return (
    `From ${first} to ${last}, the ${what} is within ${tolerance} of ${check.against}; ` +
    `the largest gap${share ? " relative to the value" : ""} is ${gap}, in ${label(check.largest_gap_period)}.`
  );
}

/** The labelled points within the rows shown (the brush's range). */
export function pointsIn(points, rows) {
  if (!rows.length) return [];
  const first = rows[0].x;
  const last = rows[rows.length - 1].x;
  return points.filter((p) => p.x >= first && p.x <= last);
}

// The largest value a view draws, in its unit. The file's own figures are
// far below it (load.js refuses any above MAX_VALUE), but an index of a
// small base or a % change on a small value can be far larger: such a line
// is not drawn, so every axis over a view's values can be stepped
export const DRAW_LIMIT = 1e12;

/**
 * Whether a series can be drawn as a line: at least two values, one
 * period after another with none missing between (a value with no
 * neighbour would be drawn as nothing), every one finite and within
 * DRAW_LIMIT.
 */
export function drawable(series) {
  const periods = [...series.keys()].sort((a, b) => a - b);
  return (
    periods.length >= 2 &&
    periods.every((t, i) => i === 0 || t === periods[i - 1] + 1) &&
    [...series.values()].every((v) => Number.isFinite(v) && Math.abs(v) <= DRAW_LIMIT)
  );
}

export const OUTTURN_KEY = "outturn";
export const vintageKey = (id) => `v_${id}`;

/**
 * Everything the chart draws for one variable: rows keyed by period
 * number, the series (outturn, then the forecasts oldest first; the last
 * is the newest), and the start, latest and end points. `unavailable`
 * says why nothing can be drawn in this unit.
 */
export function buildView(data, variable, { unit, annual = false, showPast = true }) {
  const spec = variable.units[unit];
  if (!spec) return { unavailable: "This unit is not offered for this measure." };
  const measure = variable[spec.from];
  const quarterlyAnnual = annual && variable.frequency === "quarterly";
  const levels = measureLevels(variable, measure, { annual: quarterlyAnnual });
  const frequency = levels.frequency;
  const parliament = data.meta.parliament;
  const startKey = parliament.start[frequency];
  const endKey = parliament.end[frequency];
  const start = periodIndex(startKey, frequency);
  const end = periodIndex(endKey, frequency);
  // No outturn at all in this frequency (annual totals with no year whole,
  // or every year's total lost to rounding)
  if (!levels.outturn.size) return { unavailable: "The outturn of this measure cannot be drawn in this unit." };
  const transformed = inUnit(variable, unit, levels, { annual: quarterlyAnnual, start });
  if (!transformed) return { unavailable: "There is no outturn above zero at the start of this parliament, so no index can be drawn." };
  // The newest forecast in the file is the one drawn bold and labelled at
  // the end: if it cannot be drawn, no older one takes its place
  const newestLabel = measure.vintages[measure.vintages.length - 1].label;
  // Each series is drawn whole as a line or not at all (drawable): a
  // forecast that cannot be in this unit (a % change needs the period a
  // year before; one that stops at its anchor has only that) is listed
  // as undrawn, never drawn in part
  const forecasts = transformed.vintages;
  const undrawn = [...levels.undrawn, ...forecasts.filter((v) => !drawable(v.values)).map((v) => v.label)];
  const shown = { outturn: transformed.outturn, vintages: forecasts.filter((v) => drawable(v.values)) };
  if (undrawn.includes(newestLabel) || !shown.vintages.length) {
    return { unavailable: `The ${newestLabel} forecast of this measure cannot be drawn in this unit.` };
  }
  if (!drawable(shown.outturn)) return { unavailable: "The outturn of this measure cannot be drawn in this unit." };

  const newest = shown.vintages[shown.vintages.length - 1];
  const drawn = showPast ? shown.vintages : [newest];
  const byPeriod = new Map();
  const put = (t, key, v) => {
    if (!byPeriod.has(t)) byPeriod.set(t, { x: t });
    byPeriod.get(t)[key] = v;
  };
  for (const [t, v] of shown.outturn) put(t, OUTTURN_KEY, v);
  for (const v of drawn) for (const [t, value] of v.values) put(t, vintageKey(v.id), value);
  const rows = [...byPeriod.values()].sort((a, b) => a.x - b.x);

  const latestPeriod = lastIndex(shown.outturn);
  const points = [];
  if (shown.outturn.has(start)) points.push({ role: "start", x: start, y: shown.outturn.get(start) });
  if (latestPeriod != null) points.push({ role: "latest", x: latestPeriod, y: shown.outturn.get(latestPeriod) });
  if (newest.values.has(end)) points.push({ role: "end", x: end, y: newest.values.get(end) });

  // The recent window: from two years before the earliest forecast drawn
  const perYear = frequency === "quarterly" ? 4 : 1;
  const earliest = Math.min(...drawn.map((v) => v.anchor));
  const windowStart = Math.max(0, rows.findIndex((r) => r.x >= earliest - 2 * perYear));

  return {
    unavailable: null,
    frequency,
    measure,
    unit,
    spec,
    // What the unit does to the figures (notes say it): none where they
    // are shown as published
    shownAs: [
      quarterlyAnnual ? "annual" : unit === "level" && spec.annualise ? "annualised" : null,
      unit === "index" ? "index" : unit === "pct" && spec.transform === "growth" ? "growth" : null,
    ].filter(Boolean),
    // An index names its base period: the start of the parliament
    axisLabel: unit === "index" ? `Index (${periodLabel(start, frequency)} = 100)` : spec.axis,
    format: formatterFor(variable, unit, measure),
    rows,
    outturn: shown.outturn,
    vintages: drawn.map((v) => ({
      key: vintageKey(v.id),
      id: v.id,
      label: v.label,
      anchor: v.anchor,
      reanchored: v.reanchored,
      newest: v === newest,
      values: v.values,
    })),
    newest: { key: vintageKey(newest.id), label: newest.label },
    // Earlier forecasts that cannot be drawn in this unit, oldest first
    undrawn: measure.vintages.map((v) => v.label).filter((label) => undrawn.includes(label)),
    points,
    start,
    end,
    windowStart,
    label: (t) => periodLabel(t, frequency),
  };
}

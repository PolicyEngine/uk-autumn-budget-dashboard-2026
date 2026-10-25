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
  from,
  lastIndex,
  lastWholeYear,
  pctChange,
  periodIndex,
  periodLabel,
  splice,
  toIndex,
  toSeries,
} from "./transforms";

const gb = (digits) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The unit pills a variable offers, in the page's order. */
export const UNIT_ORDER = ["level", "index", "pct"];

/**
 * Levels for one measure: the outturn and each forecast carried on from
 * it, at the variable's own frequency or (annual, for a quarterly
 * variable) as calendar-year totals.
 */
export function measureLevels(variable, measure, { annual = false } = {}) {
  const frequency = variable.frequency;
  const lag = frequency === "quarterly" ? 4 : 1;
  const outturn = toSeries(measure.outturn, frequency);
  const outturnEnd = lastIndex(outturn);
  const count = measure.vintages.length;
  const vintages = measure.vintages
    .map((vintage, i) => {
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
      return levels && { id: vintage.id, label: vintage.label, anchor, reanchored: anchor !== launch, levels, own: measure.kind === "level" };
    })
    .filter(Boolean);
  if (!annual) return { frequency, outturn, vintages };
  const yearly = annualSums(outturn);
  return {
    frequency: "calendar",
    outturn: yearly,
    vintages: vintages
      .map((v) => {
        const start = lastWholeYear(v.anchor);
        const levels = from(annualSums(splice(outturn, v.levels, v.anchor)), start);
        return levels.size > 1 && { ...v, anchor: start, levels };
      })
      .filter(Boolean),
  };
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
    const base = outturn.get(start);
    if (!base) return null;
    return map((s) => toIndex(s, base));
  }
  if (spec.from === "share") return map((s) => s);
  // % change on a year earlier: a forecast's first change is on the
  // outturn, unless it is a level drawn as published
  const lag = levels.frequency === "quarterly" ? 4 : 1;
  return map((s, v) => (!v ? pctChange(s, lag) : v.own ? pctChange(s, lag) : from(pctChange(splice(outturn, s, v.anchor), lag), v.anchor)));
}

/** Formats a value in the unit shown: (value, digits?) -> text. */
export function formatterFor(variable, unit, measure) {
  const spec = variable.units[unit];
  const n = (v, d) => gb(d).format(v);
  if (unit === "index") return (v, d = 1) => n(v, d);
  if (unit === "pct") return (v, d = 1) => `${n(v, d)}%`;
  const u = measure.unit;
  if (spec.annualise || u.startsWith("£ a") || u.startsWith("£ av") || u.startsWith("£ per")) return (v) => `£${n(v, 0)}`;
  if (u.startsWith("£ billion")) return (v, d = measure.decimals) => `£${n(v, d)}bn`;
  if (u === "million people") return (v, d = measure.decimals) => `${n(v, d)}m`;
  if (u.startsWith("%")) return (v, d = 1) => `${n(v, d)}%`;
  return (v, d = measure.decimals) => n(v, d);
}

/**
 * Round y-axis ticks over [lo, hi]: about five steps of 1, 2, 2.5 or 5 x
 * 10^n. With `zero`, 0 is kept inside the axis.
 */
export function niceAxis(lo, hi, { zero = false } = {}) {
  let a = zero ? Math.min(0, lo) : lo;
  let b = zero ? Math.max(0, hi) : hi;
  if (!(Number.isFinite(a) && Number.isFinite(b))) return { domain: [0, 1], ticks: [0, 1], step: 1 };
  // A span too small to step through (or none) is widened around it
  if (b - a <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) {
    const pad = Math.max(Math.abs(a), Math.abs(b)) * 0.05 || 1;
    a -= Math.max(pad, 1e-6);
    b += Math.max(pad, 1e-6);
  }
  const raw = (b - a) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(a / step) * step;
  const end = Math.ceil(b / step) * step;
  const ticks = [];
  const round = (v) => Math.round(v * 1e9) / 1e9;
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(round(v));
  // Rounding (or a value next to 0) can leave an end just inside the data
  while (ticks[0] > a) ticks.unshift(round(ticks[0] - step));
  while (ticks[ticks.length - 1] < b) ticks.push(round(ticks[ticks.length - 1] + step));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, step };
}

/** Decimals a tick step needs: 2.5 -> 1, 0.25 -> 2, 50 -> 0. */
export function stepDecimals(step) {
  for (let d = 0; d < 6; d += 1) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 6;
}

/** An amount in a check's units: "0.3 percentage points", "£2.1 billion". */
function checkAmount(value, units) {
  const n = gb(value < 10 ? 2 : 1).format(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
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
  const tolerance = share ? `${gb(0).format(check.tolerance * 100)}% of the value` : checkAmount(check.tolerance, check.in);
  const first = label(check.periods[0]);
  const last = label(check.periods[check.periods.length - 1]);
  const gap = checkAmount(Math.abs(check.largest_gap), check.in);
  const what = check.in.startsWith("% change") ? `ONS outturn's ${check.in}` : "ONS outturn";
  return (
    `From ${first} to ${last}, the ${what} is within ${tolerance} of ${check.against}; ` +
    `the largest gap${share ? " relative to the value" : ""} is ${gap}, in ${label(check.largest_gap_period)}.`
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
  const shown = inUnit(variable, unit, levels, { annual: quarterlyAnnual, start });
  if (!shown) return { unavailable: "There is no outturn for the start of this parliament, so no index can be drawn." };
  if (!shown.vintages.length) return { unavailable: "No OBR forecast of this measure can be drawn." };

  const newest = shown.vintages[shown.vintages.length - 1];
  const drawn = showPast ? shown.vintages : [newest];
  const byPeriod = new Map();
  const put = (t, key, v) => {
    if (v == null || !Number.isFinite(v)) return;
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
    points,
    start,
    end,
    windowStart,
    label: (t) => periodLabel(t, frequency),
  };
}

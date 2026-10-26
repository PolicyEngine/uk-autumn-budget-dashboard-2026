// Pure transforms behind the OBR forecasts view: periods, carrying each
// forecast on from the outturn, and the view's units (£, an index, %
// change on a year earlier, a year's income from a quarter's).
//
// Series are Maps from a period's number to its value, in period order.
// A period's number counts years (calendar years, and fiscal years by the
// year they start) or quarters (year * 4 + quarter - 1), so the next period
// is always one more. A period with no value is absent from the Map, never
// zero.

const QUARTER = /^(\d{4})Q([1-4])$/;
const FISCAL = /^(\d{4})-(\d{2})$/;

/** "2024Q2" -> 8097, "2024-25" -> 2024, "2024" -> 2024. */
export function periodIndex(key, frequency) {
  const text = String(key);
  if (frequency === "quarterly") {
    const m = text.match(QUARTER);
    if (!m) throw new Error(`Not a quarter: ${text}`);
    return Number(m[1]) * 4 + Number(m[2]) - 1;
  }
  if (frequency === "fiscal") {
    const m = text.match(FISCAL);
    if (!m) throw new Error(`Not a fiscal year: ${text}`);
    return Number(m[1]);
  }
  if (!/^\d{4}$/.test(text)) throw new Error(`Not a year: ${text}`);
  return Number(text);
}

/** The data's key for a period number: periodKey(periodIndex(k)) === k. */
export function periodKey(index, frequency) {
  if (frequency === "quarterly") return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
  if (frequency === "fiscal") return `${index}-${String(index + 1).slice(-2)}`;
  return String(index);
}

/** How the page writes a period: "Q2 2024", "2024-25", "2024". */
export function periodLabel(index, frequency) {
  if (frequency === "quarterly") return `Q${(index % 4) + 1} ${Math.floor(index / 4)}`;
  return periodKey(index, frequency);
}

/** {period: value} -> Map(period number -> value), in period order. */
export function toSeries(values, frequency) {
  return new Map(
    Object.entries(values || {})
      .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
      .map(([k, v]) => [periodIndex(k, frequency), v])
      .sort((a, b) => a[0] - b[0]),
  );
}

export const firstIndex = (series) => (series.size ? Math.min(...series.keys()) : null);
export const lastIndex = (series) => (series.size ? Math.max(...series.keys()) : null);

/**
 * A forecast as levels in the outturn's units, from `anchor` on.
 *
 * - growth: the forecast's % changes on a year earlier carry the outturn
 *   at the anchor forward one period at a time (`lag` periods make a year:
 *   1 for years); level(t) = level(t - lag) * (1 + g(t) / 100), with the
 *   outturn standing in for levels before the anchor.
 * - index: the outturn at the anchor times the index's ratio to its own
 *   value there.
 * - level: as published, from the anchor on.
 *
 * Returns null where the forecast cannot start (no outturn, or no forecast
 * value, at the anchor), and stops at the first period it cannot fill.
 */
export function carryForward(kind, forecast, outturn, anchor, { lag = 1 } = {}) {
  if (!["growth", "index", "level"].includes(kind)) throw new Error(`Unknown forecast kind: ${kind}`);
  const out = new Map();
  if (kind === "level") {
    for (const [t, v] of forecast) if (t >= anchor) out.set(t, v);
    return out.size ? out : null;
  }
  const base = outturn.get(anchor);
  if (base == null) return null;
  if (kind === "index") {
    const own = forecast.get(anchor);
    if (!own) return null;
    // Exactly the outturn at the anchor, so the line starts on it
    out.set(anchor, base);
    for (let t = anchor + 1; forecast.has(t); t += 1) out.set(t, (base * forecast.get(t)) / own);
    return out;
  }
  out.set(anchor, base);
  for (let t = anchor + 1; forecast.has(t); t += 1) {
    const back = t - lag;
    const prior = back > anchor ? out.get(back) : outturn.get(back);
    if (prior == null) break;
    out.set(t, prior * (1 + forecast.get(t) / 100));
  }
  return out;
}

/**
 * Where a forecast's line starts: its launch period, except that the
 * newest forecast starts from the latest outturn where the outturn has
 * run on past its launch (it is carried on from there by its own growth).
 * A level forecast is drawn as published, so it keeps its launch.
 */
export function anchorFor({ kind, launch, newest, outturnEnd, forecastEnd }) {
  if (!newest || kind === "level" || outturnEnd == null) return launch;
  return Math.max(launch, Math.min(outturnEnd, forecastEnd ?? outturnEnd));
}

/** Each value as an index of the value at `base` (= 100). */
export function toIndex(series, base) {
  const out = new Map();
  if (!base) return out;
  for (const [t, v] of series) out.set(t, (v / base) * 100);
  return out;
}

/** The inverse of toIndex: fromIndex(toIndex(s, b), b) is s. */
export function fromIndex(series, base) {
  const out = new Map();
  for (const [t, v] of series) out.set(t, (v * base) / 100);
  return out;
}

/**
 * % change on `lag` periods earlier, where both values exist and the
 * earlier is above zero (a change on zero or less has no meaning as a %).
 */
export function pctChange(series, lag) {
  const out = new Map();
  for (const [t, v] of series) {
    const prior = series.get(t - lag);
    if (prior > 0) out.set(t, (v / prior - 1) * 100);
  }
  return out;
}

/** A quarter's amount at an annual rate: times four. */
export function annualise(series, factor = 4) {
  const out = new Map();
  for (const [t, v] of series) out.set(t, v * factor);
  return out;
}

/** Calendar-year totals of quarterly values, for complete years only. */
export function annualSums(series) {
  const out = new Map();
  const years = new Set([...series.keys()].map((t) => Math.floor(t / 4)));
  for (const year of [...years].sort((a, b) => a - b)) {
    let total = 0;
    let complete = true;
    for (let q = 0; q < 4; q += 1) {
      const v = series.get(year * 4 + q);
      if (v == null) {
        complete = false;
        break;
      }
      total += v;
    }
    if (complete) out.set(year, total);
  }
  return out;
}

/** The last calendar year whose four quarters are all at or before `quarter`. */
export const lastWholeYear = (quarter) => Math.floor((quarter + 1) / 4) - 1;

/** Outturn up to `anchor`, then the forecast's levels after it. */
export function splice(outturn, levels, anchor) {
  const out = new Map();
  for (const [t, v] of outturn) if (t <= anchor) out.set(t, v);
  for (const [t, v] of levels) if (t > anchor) out.set(t, v);
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** Only the periods at or after `from`. */
export function from(series, start) {
  return new Map([...series].filter(([t]) => t >= start));
}

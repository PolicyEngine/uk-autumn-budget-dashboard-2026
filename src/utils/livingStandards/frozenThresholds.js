// Frozen thresholds against pay: the personal allowance and the higher
// rate threshold under current law, each relative to the OBR's average
// earnings (2026-27 = 100), and the trading allowance at the level the
// Budget sets, relative to earnings from its first year: a threshold that
// keeps pace with pay stays at 100, a frozen one falls.
// The income tax thresholds are the current-law values policy_parameters.json
// carries in its current_law block (uk-budget-data policy-table, the
// engine's own parameters); the trading allowance is the same file's
// Budget measure row of that name, its "after" values; earnings is the OBR
// October 2026 growth every simulation runs on
// (src/uk_budget_data/forecast/obr_october_2026.json: the detailed
// forecast tables, economy, Table 1.6).

import OCTOBER_2026 from "../../uk_budget_data/forecast/obr_october_2026.json";
import { fittedAxis } from "../chartTheme";
import { fyLabel, formatOneDp } from "./outlook";

export const BASE_YEAR = 2026;

// Each threshold: the label of the current_law row it is read from
export const THRESHOLDS = [
  { key: "personal_allowance", row: "Personal allowance" },
  { key: "higher_rate", row: "Higher rate threshold" },
];

// The trading allowance: the label of the measure row it is read from
// (whichever published measure carries it; no measure id is named here)
export const TRADING = { key: "trading_allowance", row: "Trading allowance" };

/**
 * The trading allowance the Budget sets, from its measure's row: { start,
 * values } with `start` the first year it differs from current law (the
 * year the new level takes effect) and `values` its level by fiscal year
 * from then; null without the measure.
 */
export function tradingAllowance(document) {
  const found = Object.values(document?.measures ?? {})
    .flatMap((m) => m?.rows ?? [])
    .find((r) => r.label === TRADING.row);
  const points = (found?.points ?? []).filter((p) => Number.isFinite(p.year) && Number.isFinite(p.after));
  const first = points.find((p) => p.after !== p.before);
  if (!first) return null;
  return { start: first.year, values: Object.fromEntries(points.filter((p) => p.year >= first.year).map((p) => [p.year, p.after])) };
}

/** A threshold's current-law value by fiscal year (start year), or null if absent. */
export function thresholdValues(document, { row }) {
  const found = (document?.current_law?.rows ?? []).find((r) => r.label === row && r.points?.length);
  if (!found?.points?.length) return null;
  return Object.fromEntries(found.points.filter((p) => Number.isFinite(p.before)).map((p) => [p.year, p.before]));
}

const EARNINGS_PARAMETER = "gov.economic_assumptions.yoy_growth.obr.average_earnings";

/**
 * The OBR October 2026 earnings growth the runs use, as { year: rate }
 * (calendar years, rate a fraction), from the forecast file's
 * "YYYY-01-01.YYYY-12-31" keys; null without it.
 */
export function earningsGrowth(forecast = OCTOBER_2026) {
  const values = forecast?.parameter_changes?.[EARNINGS_PARAMETER]?.values;
  if (!values) return null;
  return Object.fromEntries(
    Object.entries(values)
      .map(([period, value]) => [Number(period.slice(0, 4)), value])
      .filter(([year, value]) => Number.isFinite(year) && Number.isFinite(value)),
  );
}

/**
 * Average earnings indexed to 2026-27 = 100, by fiscal year: as the
 * baseline does, a fiscal year takes the growth of the calendar year it
 * starts in (2027-28 grows on 2026-27 by 2027's rate), so the index runs
 * to the fiscal year starting in the forecast's last calendar year.
 */
export function earningsIndex(growth) {
  const index = { [BASE_YEAR]: 100 };
  for (let year = BASE_YEAR + 1; growth?.[year] != null; year += 1) index[year] = index[year - 1] * (1 + growth[year]);
  return index;
}

/**
 * One row per fiscal year (year: its start), 2026-27 to the last year of
 * the earnings index: `earnings`, average earnings indexed to 2026-27 =
 * 100, and each threshold relative to average earnings (its own index
 * divided by the earnings index, times 100), so a threshold that keeps
 * pace with pay stays at 100; null when the data is missing. The trading
 * allowance is indexed to its own first year, both it and earnings, so its
 * line starts at 100 there and is null before (and absent without the
 * measure).
 */
export function thresholdRows(document, growth = earningsGrowth()) {
  const values = THRESHOLDS.map((t) => [t.key, thresholdValues(document, t)]);
  if (!growth || values.some(([, v]) => !v?.[BASE_YEAR])) return null;
  const earnings = earningsIndex(growth);
  const years = Object.keys(earnings).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return null;
  const trading = tradingAllowance(document);
  const tradingAt = (year) => {
    const v = trading?.values;
    if (!v || year < trading.start || v[year] == null || earnings[trading.start] == null) return null;
    return (100 * (v[year] / v[trading.start])) / (earnings[year] / earnings[trading.start]);
  };
  return years.map((year) => ({
    year,
    earnings: earnings[year],
    ...Object.fromEntries(
      values.map(([key, v]) => [key, v[year] != null ? (100 * ((100 * v[year]) / v[BASE_YEAR])) / earnings[year] : null]),
    ),
    ...(trading ? { [TRADING.key]: tradingAt(year) } : {}),
  }));
}

/** Whether the personal allowance and higher rate threshold move together in every year (both frozen), so one line draws both. */
export function sameThresholds(rows) {
  return Boolean(rows?.length) && rows.every((r) => r.personal_allowance != null && Math.abs(r.personal_allowance - (r.higher_rate ?? NaN)) < 1e-9);
}

const change = (relative) => `${formatOneDp(Math.abs(relative - 100))}% ${relative < 100 ? "less" : "more"}`;

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;

/**
 * The card's sentence, from the last row: what the income tax thresholds
 * are worth against average earnings, then the trading allowance (with
 * its level and first year, from `trading`) when it has a line.
 */
export function thresholdsSentence(rows, trading = null) {
  const last = rows?.at(-1);
  if (last?.personal_allowance == null || last.higher_rate == null) return null;
  const tail = `relative to average earnings than in ${fyLabel(BASE_YEAR)}`;
  const income = sameThresholds(rows)
    ? `By ${fyLabel(last.year)} the personal allowance and higher rate threshold are worth ${change(last.personal_allowance)} ${tail}`
    : `By ${fyLabel(last.year)} the personal allowance is worth ${change(last.personal_allowance)} and the higher rate threshold ${change(last.higher_rate)} ${tail}`;
  const ta = last[TRADING.key];
  if (ta == null || !trading || last.year <= trading.start) return `${income}.`;
  return `${income}; the trading allowance, ${pounds(trading.values[trading.start])} from ${fyLabel(trading.start)}, is worth ${change(ta)} than in its first year.`;
}

/**
 * The y axis of values relative to average earnings: fitted to the gaps
 * from 100 (chartTheme.fittedAxis), with a step of room above 100 so the
 * reference line is not the plot's top edge.
 */
export function relativeAxis(values) {
  const gaps = values.filter((v) => v != null && Number.isFinite(v)).map((v) => v - 100);
  const { domain, ticks } = fittedAxis([...gaps, 0.5]);
  return { domain: domain.map((v) => v + 100), ticks: ticks.map((v) => v + 100) };
}

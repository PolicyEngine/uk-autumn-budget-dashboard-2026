// Frozen thresholds against pay: the personal allowance, the higher rate
// threshold and the Plan 2 student loan repayment threshold under current
// law, against the OBR's average earnings, each indexed to 2026-27 = 100.
// The thresholds are the current-law ("before") values the Policies tab
// reads (public/data/policy_parameters.json); earnings is the OBR March
// 2026 growth in the outlook file (public/data/living_standards_outlook.json).

import { fyLabel, formatOneDp } from "./outlook";

export const BASE_YEAR = 2026;

// Each threshold: the parameter row label it is read from, in whichever
// published entry carries it
export const THRESHOLDS = [
  { key: "personal_allowance", row: "Personal allowance" },
  { key: "higher_rate", row: "Higher rate threshold" },
  { key: "plan_2", row: "Plan 2 repayment threshold" },
];

/** A threshold's current-law value by fiscal year (start year), or null if absent. */
export function thresholdValues(document, { row }) {
  const found = Object.values(document?.measures ?? {})
    .flatMap((entry) => entry?.rows ?? [])
    .find((r) => r.label === row && r.points?.length);
  if (!found?.points?.length) return null;
  return Object.fromEntries(found.points.filter((p) => Number.isFinite(p.before)).map((p) => [p.year, p.before]));
}

/**
 * The OBR earnings growth before the measures, as { year: rate } (calendar
 * years, rate a fraction), or null.
 */
export function earningsGrowth(outlook) {
  const series = outlook?.forecast?.sections?.flatMap((s) => s.series).find((s) => s.key === "earnings");
  if (!series?.pre?.length) return null;
  return Object.fromEntries(series.pre.filter((p) => Number.isFinite(p.value)).map((p) => [Number(p.year), p.value]));
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
 * the earnings index, each line indexed to 2026-27 = 100; null when the
 * data is missing.
 */
export function thresholdRows(document, outlook) {
  const growth = earningsGrowth(outlook);
  const values = THRESHOLDS.map((t) => [t.key, thresholdValues(document, t)]);
  if (!growth || values.some(([, v]) => !v?.[BASE_YEAR])) return null;
  const earnings = earningsIndex(growth);
  const years = Object.keys(earnings).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return null;
  return years.map((year) => ({
    year,
    earnings: earnings[year],
    ...Object.fromEntries(values.map(([key, v]) => [key, v[year] != null ? (100 * v[year]) / v[BASE_YEAR] : null])),
  }));
}

const pctHigher = (index) => `${formatOneDp(index - 100)}%`;

/** The card's sentence, from the last row: earnings' rise against the thresholds held at 2026-27's level. */
export function thresholdsSentence(rows) {
  const last = rows?.at(-1);
  if (!last) return null;
  const frozen = [
    last.personal_allowance != null && Math.abs(last.personal_allowance - 100) < 1e-9 && "the personal allowance",
    last.higher_rate != null && Math.abs(last.higher_rate - 100) < 1e-9 && "the higher rate threshold",
  ].filter(Boolean);
  const lead = `By ${fyLabel(last.year)} average earnings are ${pctHigher(last.earnings)} higher than in ${fyLabel(BASE_YEAR)}`;
  if (frozen.length === 2) return `${lead}, while the personal allowance and higher rate threshold are unchanged.`;
  if (frozen.length === 1) return `${lead}, while ${frozen[0]} is unchanged.`;
  return `${lead}, against ${pctHigher(last.personal_allowance)} for the personal allowance.`;
}

/** An axis for index values: whole steps of 2 (or 5 over a wider range) around 100. */
export function indexAxis(values) {
  const lo = Math.min(100, ...values);
  const hi = Math.max(100, ...values);
  const step = hi - lo > 20 ? 5 : 2;
  const from = Math.floor((lo - 0.5) / step) * step;
  const to = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = from; v <= to + 1e-9; v += step) ticks.push(v);
  return { domain: [from, to], ticks };
}

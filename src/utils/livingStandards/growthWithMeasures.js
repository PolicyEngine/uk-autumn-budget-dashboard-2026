/**
 * Growth across the distribution with the selected measures
 * (public/data/income_growth_with_measures.csv, written by
 * `uk-budget-data generate --only income_growth`).
 *
 * Each row is one income group's median HBAI income in one year, under a
 * measure's (or the package's) reform and under its own baseline, in
 * 2027-28 prices, with each side's real change on the year before and the
 * difference between them (the reform's growth less its baseline's, from
 * the same pair of simulations). The income, groups and prices are the
 * Pre-measures forecast's income_growth_by_group. Vigintile 1 has no rows.
 *
 * The file is read directly, as income_distribution.csv is (#104 reads
 * verified artifacts for the Budget tables; these flat files sit beside
 * them with their own review rows).
 */
import { parseCsv } from "../publication/csv";
import { fyLabel } from "./outlook";

export const GROWTH_WITH_MEASURES_FILE = "income_growth_with_measures.csv";

const NUMERIC = [
  "year",
  "group",
  "baseline_real_median",
  "reform_real_median",
  "baseline_annual_growth",
  "reform_annual_growth",
  "growth_difference",
];
const COLUMNS = ["reform_id", "population", "basis", "grouping", ...NUMERIC];

/** The CSV as rows with numbers parsed. */
export function parseGrowthWithMeasures(text) {
  const [header, ...body] = parseCsv(text).filter((row) => row.length > 1);
  if (!header) return [];
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  if (Object.values(at).some((i) => i < 0)) throw new Error(`${GROWTH_WITH_MEASURES_FILE}: missing columns`);
  return body.map((row) => {
    const out = {};
    for (const c of COLUMNS) out[c] = NUMERIC.includes(c) ? Number(row[at[c]]) : row[at[c]];
    return out;
  });
}

/** The groupings, populations and bases a run has rows for. */
export function offerFor(rows, reformId) {
  const mine = rows.filter((r) => r.reform_id === reformId);
  const uniq = (key) => [...new Set(mine.map((r) => r[key]))];
  return { groupings: uniq("grouping"), populations: uniq("population"), bases: uniq("basis") };
}

/**
 * One run's series in the shape the growth chart reads
 * (DecileGrowthSection's growthRows): [{ year: "2027-28", real_median,
 * annual, cumulative, base_cumulative, difference }], each an array over
 * the grouping's groups, with null where the file has no row (vigintile
 * 1). `real_median`, `annual` and `cumulative` are the reform side's;
 * `base_cumulative` the baseline's and `difference` the change in annual
 * growth, as fractions. Cumulative growth is since the first year.
 */
export function seriesFor(rows, { reformId, population, basis, grouping }) {
  const mine = rows.filter((r) => r.reform_id === reformId && r.population === population && r.basis === basis && r.grouping === grouping);
  if (!mine.length) return null;
  const years = [...new Set(mine.map((r) => r.year))].sort((a, b) => a - b);
  const n = Math.max(...mine.map((r) => r.group));
  const at = new Map(mine.map((r) => [`${r.year}:${r.group}`, r]));
  const pick = (year, key) => Array.from({ length: n }, (_, k) => at.get(`${year}:${k + 1}`)?.[key] ?? null);
  const first = years[0];
  const ratio = (a, b) => a.map((v, k) => (v == null || b[k] == null ? null : v / b[k] - 1));
  return years.map((year) => ({
    year: fyLabel(year),
    real_median: pick(year, "reform_real_median"),
    annual: pick(year, "reform_annual_growth"),
    difference: pick(year, "growth_difference"),
    cumulative: ratio(pick(year, "reform_real_median"), pick(first, "reform_real_median")),
    base_cumulative: ratio(pick(year, "baseline_real_median"), pick(first, "baseline_real_median")),
  }));
}

/** Whether a run moves no group's growth in any year (HBAI income does not see it). */
export function changesNothing(rows, reformId) {
  const mine = rows.filter((r) => r.reform_id === reformId);
  return mine.length > 0 && mine.every((r) => r.growth_difference === 0);
}

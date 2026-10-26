/**
 * Where a household sits in the UK income distribution, before and after
 * the selected policies (public/data/income_distribution.csv).
 *
 * The file holds percentiles (5th to 95th) of equivalised household net
 * income: household net income as the household calculator counts it
 * (uk_budget_data.calculators.comparable_net_income: no NHS spending in
 * kind, no attributed business rates or stamp duty) divided by the HBAI
 * modified OECD scale, counting people, not households. Each measure has
 * two curves: "baseline", everyone's income before it, and "reform",
 * everyone's income after it. A household's position before is read off
 * the baseline curve and its position after off the reform curve, since
 * everyone else's income changes too.
 */
import { COMBINED_REFORM_ID } from "./policyConfig";
import { parseCsv } from "./publication/csv";

export const DISTRIBUTION_FILE = "income_distribution.csv";
export const LOWEST_PERCENTILE = 5;
export const HIGHEST_PERCENTILE = 95;

// The HBAI modified OECD scale (BHC), as policyengine-uk's
// household_equivalisation_bhc: 0.67 for the first adult, 0.33 for each
// other adult and each child aged 14 or over, 0.2 for each child under 14.
// A child of 14 or over weighs the same whether HBAI counts them as a
// dependent child or an adult, so the scale needs only ages.
export const EQUIVALENCE = { firstAdult: 0.67, otherAdult: 0.33, olderChild: 0.33, youngChild: 0.2, childAge: 14 };

/**
 * The equivalence factor of a household request's `household` (the
 * calculator's answers as buildHouseholdRequest sends them): the reader,
 * a partner if any, and the children by age.
 */
export function equivalenceFactor(household) {
  const children = Array.isArray(household?.children) ? household.children : [];
  return (
    EQUIVALENCE.firstAdult +
    (household?.has_partner ? EQUIVALENCE.otherAdult : 0) +
    children.reduce(
      (sum, child) => sum + (Number(child?.age) < EQUIVALENCE.childAge ? EQUIVALENCE.youngChild : EQUIVALENCE.olderChild),
      0,
    )
  );
}

/** income_distribution.csv as rows: { reformId, year, side, percentile, income }. */
export function parseDistribution(text) {
  const [header, ...body] = parseCsv(text).filter((row) => row.length > 1);
  if (!header) return [];
  const at = (name) => header.indexOf(name);
  const columns = {
    reformId: at("reform_id"),
    year: at("year"),
    side: at("side"),
    percentile: at("percentile"),
    income: at("equivalised_net_income"),
  };
  if (Object.values(columns).some((index) => index < 0)) {
    throw new Error(`${DISTRIBUTION_FILE}: missing columns`);
  }
  return body.map((row) => ({
    reformId: row[columns.reformId],
    year: Number(row[columns.year]),
    side: row[columns.side],
    percentile: Number(row[columns.percentile]),
    income: Number(row[columns.income]),
  }));
}

/**
 * Which published run stands for the selection: one measure is its own
 * run; two or more are the whole package's run, which is exact only when
 * every measure is selected (`exact`), since runs for part of the package
 * are not published.
 */
export function distributionRunFor(selected, allIds) {
  const ids = [...new Set(selected ?? [])];
  if (ids.length === 1) return { reformId: ids[0], exact: true };
  const all = allIds.length > 0 && allIds.every((id) => ids.includes(id));
  return { reformId: COMBINED_REFORM_ID, exact: all };
}

/** One curve, sorted by percentile: [{ percentile, income }]. */
export function curveOf(rows, { reformId, year, side }) {
  return rows
    .filter((row) => row.reformId === reformId && row.year === year && row.side === side)
    .map(({ percentile, income }) => ({ percentile, income }))
    .sort((a, b) => a.percentile - b.percentile);
}

/**
 * Where an income sits on a curve: { percentile, below, above }. Linear
 * between published points; below the lowest point `below` is true (and
 * percentile is null), above the highest `above` is.
 */
export function percentileOn(curve, income) {
  if (!curve.length || !Number.isFinite(income)) return { percentile: null, below: false, above: false };
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (income < first.income) return { percentile: null, below: true, above: false };
  if (income > last.income) return { percentile: null, below: false, above: true };
  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const b = curve[i + 1];
    if (income <= b.income) {
      const span = b.income - a.income;
      const t = span > 0 ? (income - a.income) / span : 0;
      return { percentile: a.percentile + t * (b.percentile - a.percentile), below: false, above: false };
    }
  }
  return { percentile: last.percentile, below: false, above: false };
}

/** The income at a percentile on a curve, linear between points. */
export function incomeAt(curve, percentile) {
  if (!curve.length) return null;
  if (percentile <= curve[0].percentile) return curve[0].income;
  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const b = curve[i + 1];
    if (percentile <= b.percentile) {
      const t = (percentile - a.percentile) / (b.percentile - a.percentile || 1);
      return a.income + t * (b.income - a.income);
    }
  }
  return curve[curve.length - 1].income;
}

/** "47th", "1st", "22nd", "13th" */
export function ordinal(n) {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  return `${v}${{ 1: "st", 2: "nd", 3: "rd" }[v % 10] ?? "th"}`;
}

/** How a position reads: "the 47th percentile", "the bottom 5%", "the top 5%". */
export function describePosition(position) {
  if (position.below) return `the bottom ${LOWEST_PERCENTILE}%`;
  if (position.above) return `the top ${100 - HIGHEST_PERCENTILE}%`;
  if (position.percentile === null) return null;
  return `the ${ordinal(position.percentile)} percentile`;
}

/**
 * The household's position before and after: its equivalised net income
 * each side, where that sits on each side's own curve, and the change in
 * whole percentiles (null when either side is off the published range).
 */
export function householdPosition({ net, household, before, after }) {
  const factor = equivalenceFactor(household);
  const incomeBefore = Number(net?.before) / factor;
  const incomeAfter = Number(net?.after) / factor;
  const posBefore = percentileOn(before, incomeBefore);
  const posAfter = percentileOn(after, incomeAfter);
  const inRange = posBefore.percentile !== null && posAfter.percentile !== null;
  const pointChange = inRange ? Math.round(posAfter.percentile) - Math.round(posBefore.percentile) : null;
  const sameLabel = describePosition(posBefore) === describePosition(posAfter);
  return {
    factor,
    incomeBefore,
    incomeAfter,
    change: incomeAfter - incomeBefore,
    before: posBefore,
    after: posAfter,
    pointChange,
    // Exact change in percentiles, unrounded, for the close-up
    exactChange: inRange ? posAfter.percentile - posBefore.percentile : null,
    unchanged: sameLabel,
  };
}

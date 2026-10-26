/**
 * Where a household sits in the UK income distribution, before and after
 * the selected policies (public/data/income_distribution.csv).
 *
 * The file holds percentiles (1st to 99th) of equivalised household net
 * income: household net income as the household calculator counts it
 * (uk_budget_data.calculators.comparable_net_income: no NHS spending in
 * kind, no attributed business rates or stamp duty) divided by the HBAI
 * modified OECD scale, counting people, not households. Each measure has
 * two curves: "baseline", everyone's income before it, and "reform",
 * everyone's income after it. A household's position before is read off
 * the baseline curve and its position after off the reform curve, since
 * everyone else's income changes too.
 */
// The whole package's run in the pipeline's own CSVs (reforms.py's
// AUTUMN_BUDGET_2026_COMBINED_ID); policyConfig.js, which held it, is gone
// on #104
export const COMBINED_REFORM_ID = "autumn_budget_2026_combined";
import { parseCsv } from "./publication/csv";

export const DISTRIBUTION_FILE = "income_distribution.csv";
export const LOWEST_PERCENTILE = 1;
export const HIGHEST_PERCENTILE = 99;

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

const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Which published run stands for the selection: one measure is its own
 * run; two or more are the whole package's run, which is exact (`exact`)
 * only when every published measure is selected and the package was run
 * with exactly those (`packageIds`, the catalogue's package members, or
 * null when it publishes none), since runs for part of the package are not
 * published. After a measure is withdrawn the package's run still holds it,
 * so it is never exact then (#104 review).
 */
export function distributionRunFor(selected, allIds, packageIds = null) {
  const ids = [...new Set(selected ?? [])];
  if (ids.length === 1) return { reformId: ids[0], exact: true };
  const exact = Boolean(packageIds) && allIds.length > 0 && sameSet(ids, allIds) && sameSet(packageIds, allIds);
  return { reformId: COMBINED_REFORM_ID, exact };
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
  if (income < first.income) return { percentile: null, below: true, above: false, edge: first.percentile };
  if (income > last.income) return { percentile: null, below: false, above: true, edge: last.percentile };
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
  if (position.below) return `the bottom ${position.edge ?? LOWEST_PERCENTILE}%`;
  if (position.above) return `the top ${100 - (position.edge ?? HIGHEST_PERCENTILE)}%`;
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

/**
 * The share of people (0 to 1) with an income in each band [edges[i],
 * edges[i+1]), from a curve: the difference of the percentiles at the two
 * edges, linear between published points. Edges must lie within the
 * curve's range.
 */
export function bandShares(curve, edges) {
  const at = (income) => percentileOn(curve, income).percentile;
  const shares = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = at(edges[i]);
    const hi = at(edges[i + 1]);
    shares.push(lo === null || hi === null ? 0 : Math.max(0, hi - lo) / 100);
  }
  return shares;
}

/** Band edges of a round width inside a curve's published range. */
export function bandEdges(curve, width) {
  const first = Math.ceil(curve[0].income / width) * width;
  const last = Math.floor(curve[curve.length - 1].income / width) * width;
  const edges = [];
  for (let edge = first; edge <= last; edge += width) edges.push(edge);
  return edges;
}

/** Decile (1 to 10) of a position: from its percentile, or the end it is off. */
export function decileOf(position) {
  if (position.below) return 1;
  if (position.above) return 10;
  if (position.percentile === null) return null;
  return Math.min(10, Math.floor(position.percentile / 10) + 1);
}

/**
 * Average change per household by decile for the selected measures, from
 * winners_losers.csv rows ({ reform_id, year, decile, avg_change }), added
 * up across the measures as the decile charts add them: { 1: £, ... 10: £ },
 * or null when a selected measure has no rows for the year.
 */
export function decileAverages(rows, selected, year) {
  const ids = [...new Set(selected ?? [])];
  if (!ids.length) return null;
  const totals = {};
  for (const id of ids) {
    const own = rows.filter((row) => row.reform_id === id && Number(row.year) === year && row.decile !== "all");
    if (own.length < 10) return null;
    for (const row of own) {
      const decile = Number(row.decile);
      totals[decile] = (totals[decile] ?? 0) + Number(row.avg_change);
    }
  }
  return totals;
}

const DECILE_NAMES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

/**
 * Change in net income as a % of net income by decile for the selected
 * measures, from distributional_impact.csv rows ({ reform_id, year, decile:
 * "1st".."10th", value }), added up across the measures as the decile
 * charts add them: { 1: %, ... 10: % }, or null when a selected measure has
 * no rows for the year.
 */
export function decilePercents(rows, selected, year) {
  const ids = [...new Set(selected ?? [])];
  if (!ids.length) return null;
  const totals = {};
  for (const id of ids) {
    const own = rows.filter((row) => row.reform_id === id && Number(row.year) === year && DECILE_NAMES.includes(row.decile));
    if (own.length < 10) return null;
    for (const row of own) {
      const decile = DECILE_NAMES.indexOf(row.decile) + 1;
      totals[decile] = (totals[decile] ?? 0) + Number(row.value);
    }
  }
  return totals;
}

/** The UK-wide average change per household (winners_losers.csv "all"), added up across the measures. */
export function overallAverage(rows, selected, year) {
  const ids = [...new Set(selected ?? [])];
  if (!ids.length) return null;
  let total = 0;
  for (const id of ids) {
    const row = rows.find((r) => r.reform_id === id && Number(r.year) === year && r.decile === "all");
    if (!row) return null;
    total += Number(row.avg_change);
  }
  return total;
}

/** n edges spaced evenly on a log scale from `lo` to `hi`. */
export function logEdges(lo, hi, bands) {
  const a = Math.log(lo);
  const b = Math.log(hi);
  return Array.from({ length: bands + 1 }, (_, i) => Math.exp(a + ((b - a) * i) / bands));
}

export const MOBILITY_FILE = "income_mobility.csv";

/**
 * income_mobility.csv's rows for one run, year and unit ("percentile" or
 * "decile"): { all: { up, down, same }, 1: {...}, ... 10: {...} }, each a
 * % of people, null where the file leaves a share blank (too few survey
 * households), or null when the run has no rows.
 */
export function mobilityOf(rows, { reformId, year, unit }) {
  const own = rows.filter((row) => row.reform_id === reformId && Number(row.year) === year && row.unit === unit);
  if (!own.length) return null;
  const value = (text) => (text === "" || text === undefined || text === null ? null : Number(text));
  return Object.fromEntries(
    own.map((row) => [row.start_decile, { up: value(row.pct_up), down: value(row.pct_down), same: value(row.pct_same) }]),
  );
}

const signedMoney = (value) => {
  const rounded = Math.round(value);
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return rounded > 0 ? `+${text}` : rounded < 0 ? `−${text}` : "£0";
};

/** A position's short name: "12th percentile", "top 1%", "bottom 1%". */
export function placeLabel(pos) {
  if (pos.above) return `top ${100 - (pos.edge ?? HIGHEST_PERCENTILE)}%`;
  if (pos.below) return `bottom ${pos.edge ?? LOWEST_PERCENTILE}%`;
  return `${ordinal(pos.percentile)} percentile`;
}

/**
 * How many in every 100 people live in households with a lower income than
 * this position, as words: "47", or "fewer than 1" / "more than 99" off the
 * published range. One rounding everywhere (the tiles' percentile too).
 */
export function lowerCount(pos) {
  if (pos.below) return `fewer than ${pos.edge ?? LOWEST_PERCENTILE}`;
  if (pos.above) return `more than ${pos.edge ?? HIGHEST_PERCENTILE}`;
  if (pos.percentile === null) return null;
  return String(Math.round(pos.percentile));
}

/** What the number measures, said once and the same everywhere. */
export const PLACE_MEANING = "live in households with a lower income than yours, once incomes are adjusted for household size";

/**
 * The card's text: a one-sentence headline and three labelled chips (your
 * change, its share of your net income, your place before and after).
 * Each fact once. The headline says exactly what the number is: how many
 * in every 100 people in the UK live in households with a lower income,
 * both adjusted for household size, on `side` ("before" or "after" the
 * selected policies), naming the side only when the two differ.
 */
export function positionSummary(position, change, netBefore, side = "after") {
  const shown = side === "before" ? position.before : position.after;
  const differs = lowerCount(position.before) !== lowerCount(position.after);
  const count = lowerCount(shown);
  const capital = count ? count.charAt(0).toUpperCase() + count.slice(1) : null;
  const headline = count
    ? `${capital} in every 100 people in the UK ${PLACE_MEANING}${differs ? `, ${side === "before" ? "before" : "after"} the selected policies` : ""}.`
    : "Your place in the UK income distribution is not available.";
  const after = position.after;
  const before = placeLabel(position.before);
  const now = placeLabel(after);
  const moved = before !== now;
  const share = netBefore > 0 ? (change / netBefore) * 100 : null;
  const chips = [
    { key: "change", label: "Your change", value: `${signedMoney(change)} a year` },
    {
      key: "share",
      label: "Share of your income",
      value: share === null ? "Not available" : `${share > 0 ? "+" : share < 0 ? "−" : ""}${Math.abs(share).toFixed(2)}%`,
    },
    {
      key: "place",
      label: "Your place",
      value: moved
        ? `${before.replace(" percentile", "")} → ${now}`
        : `unchanged (${now})`,
    },
  ];
  return { headline, chips, moved };
}

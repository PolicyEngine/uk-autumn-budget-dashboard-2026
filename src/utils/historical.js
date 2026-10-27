/**
 * The flat views of a past fiscal event's release (docs/historical-releases.md):
 * its coverage, the measures it does not model, and the OBR's costing of the
 * ones it does. uk_budget_data.historical_events writes them; the release
 * index binds them to the release's manifest; this module reads them.
 *
 * The coverage shares are exact fractions ("p/q"), as the scorecard states
 * them, and the pound amounts are exact decimals. They are read as BigInt
 * fractions, so the page can check that the classes partition the event and
 * that the gap rows add up to their class without rounding.
 */
import { parseCsv } from "./publication/csv";

/** Raised when a flat view is not what the historical release writes. */
export class HistoricalDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "HistoricalDataError";
  }
}

// The headers, in order, as uk_budget_data.publication.release_index checks them
export const COVERAGE_HEADER = ["class", "gap_kind", "measures", "rows", "net_gbp", "absolute_gbp", "share_of_absolute", "share_of_measures"];
export const NOT_MODELLED_HEADER = ["reform_id", "reform_name", "classification", "gap_kind", "reason", "rows", "obr_absolute_gbp"];
export const OBR_HEADER = ["reform_id", "reform_name", "year", "obr_gbp", "obr_modelled_heads_gbp", "replay_policyengine_gbp", "replay_pair"];

// The scorecard's classes, which partition an event's measures and the
// absolute value of its OBR costing (policyengine-scorecard
// docs/uk_replay/RECIPE.md), and the coverage table's row for the measures
// the replay computed.
export const CLASSES = ["expressible", "partial", "not_expressible", "out_of_household_scope"];
export const COMPUTED_ROW = "computed_by_replay";

export const CLASS_LABELS = {
  expressible: "Expressible",
  partial: "Partly expressible",
  not_expressible: "Not expressible",
  out_of_household_scope: "Outside household scope",
};

export const CLASS_NOTES = {
  expressible: "A parameter construction covers the measure, with each OBR head mapped.",
  partial: "The household part runs; the parts it leaves out are listed with the measure.",
  not_expressible: "The model lacks a tax base, entitlement, history, data input or counterfactual the measure needs.",
  out_of_household_scope: "Business, departmental, local-government or financing accounts, such as corporation tax and business rates.",
};

export const GAP_LABELS = {
  construction_pending: "No executable construction yet. This does not show that the model lacks the tax or benefit.",
  model_or_data_gap: "A model mechanism or data input is missing.",
  dashboard_import: "The replay computed it, but this dashboard cannot carry its construction.",
};

/** A gap kind's description, or its own name for one this page does not know. */
export const gapLabel = (gap) => GAP_LABELS[gap] ?? gap.replaceAll("_", " ");

const gcd = (a, b) => {
  let [x, y] = [a < 0n ? -a : a, b];
  while (y) [x, y] = [y, x % y];
  return x;
};

/** A fraction in lowest terms, with a positive denominator. */
export function fraction(num, den = 1n) {
  if (den === 0n) throw new HistoricalDataError("a fraction has a zero denominator");
  if (den < 0n) [num, den] = [-num, -den];
  const divisor = gcd(num, den) || 1n;
  return { num: num / divisor, den: den / divisor };
}

export const ZERO = fraction(0n);
export const ONE = fraction(1n);

export const add = (a, b) => fraction(a.num * b.den + b.num * a.den, a.den * b.den);
export const sum = (values) => values.reduce(add, ZERO);
export const equals = (a, b) => a.num === b.num && a.den === b.den;
export const divide = (a, b) => fraction(a.num * b.den, a.den * b.num);
export const negate = (a) => fraction(-a.num, a.den);
export const abs = (a) => fraction(a.num < 0n ? -a.num : a.num, a.den);
export const compare = (a, b) => {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
};

/** An exact share, "p/q", non-negative. */
export function parseShare(text) {
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match) throw new HistoricalDataError(`${JSON.stringify(text)} is not an exact share`);
  return fraction(BigInt(match[1]), BigInt(match[2]));
}

/** An exact decimal, such as "-1234.5", as a fraction. */
export function parseDecimal(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new HistoricalDataError(`${JSON.stringify(text)} is not an exact decimal`);
  const [, sign, whole, decimals = ""] = match;
  const num = BigInt(whole + decimals);
  return fraction(sign ? -num : num, 10n ** BigInt(decimals.length));
}

/** A count: a non-negative integer the page can hold exactly. */
export function parseCount(text) {
  if (!/^(0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HistoricalDataError(`${JSON.stringify(text)} is not a count`);
  }
  return Number(text);
}

/** A fraction as a number, for display only. */
export const toNumber = (a) => Number(a.num) / Number(a.den);

/**
 * A share as a percentage to one decimal place, rounded half up exactly. A
 * share that is not zero but rounds to it reads "under 0.1%", never "0.0%".
 */
export function formatShare(share) {
  const tenths = (share.num * 1000n * 2n + share.den) / (share.den * 2n);
  if (tenths === 0n && share.num !== 0n) return "under 0.1%";
  return `${tenths / 10n}.${tenths % 10n}%`;
}

function records(text, header, name) {
  const [found, ...rows] = parseCsv(text);
  if (!found || found.length !== header.length || found.some((cell, index) => cell !== header[index])) {
    throw new HistoricalDataError(`${name} does not have the expected columns`);
  }
  return rows
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      if (row.length !== header.length) throw new HistoricalDataError(`${name} has a row of the wrong length`);
      return Object.fromEntries(header.map((column, index) => [column, row[index]]));
    });
}

function coverageEntry(row) {
  return {
    measures: parseCount(row.measures),
    rows: parseCount(row.rows),
    net: row.net_gbp === "" ? null : parseDecimal(row.net_gbp),
    absolute: parseDecimal(row.absolute_gbp),
    shareOfAbsolute: parseShare(row.share_of_absolute),
    shareOfMeasures: parseShare(row.share_of_measures),
  };
}

/**
 * The coverage table: one entry per class, one per kind of gap in the
 * not-expressible class, and the replay's computed measures. The shape is
 * checked here; whether it adds up is coverageProblems'.
 */
export function parseCoverage(text) {
  const classes = {};
  const gaps = {};
  let computed = null;
  for (const row of records(text, COVERAGE_HEADER, "coverage.csv")) {
    const entry = coverageEntry(row);
    if (row.class === COMPUTED_ROW && !row.gap_kind) {
      if (computed) throw new HistoricalDataError("coverage.csv lists the computed measures twice");
      computed = entry;
    } else if (CLASSES.includes(row.class) && !row.gap_kind) {
      if (classes[row.class]) throw new HistoricalDataError(`coverage.csv lists ${row.class} twice`);
      if (entry.net === null) throw new HistoricalDataError(`coverage.csv gives ${row.class} no net value`);
      classes[row.class] = entry;
    } else if (row.class === "not_expressible" && /^[a-z][a-z_]*$/.test(row.gap_kind)) {
      if (gaps[row.gap_kind]) throw new HistoricalDataError(`coverage.csv lists ${row.gap_kind} twice`);
      if (entry.net === null) throw new HistoricalDataError(`coverage.csv gives ${row.gap_kind} no net value`);
      gaps[row.gap_kind] = entry;
    } else {
      throw new HistoricalDataError(`coverage.csv has an unknown row ${JSON.stringify([row.class, row.gap_kind])}`);
    }
  }
  const missing = CLASSES.filter((name) => !classes[name]);
  if (missing.length) throw new HistoricalDataError(`coverage.csv has no row for ${missing.join(", ")}`);
  if (!computed) throw new HistoricalDataError("coverage.csv has no row for the computed measures");
  return { classes, gaps, computed };
}

/**
 * Every way the coverage fails to add up, as messages; none for a table
 * whose classes partition the event's measures and the absolute value of its
 * OBR costing, whose shares are those exact quotients (so none is above
 * one), whose gap rows add up to the not-expressible class (an empty set of
 * gap rows to an empty class), and whose computed measures are within the
 * expressible and partly expressible classes and computed rows and value
 * within the event's. Counts are summed as BigInt, so no total is rounded.
 */
export function coverageProblems({ classes, gaps, computed }) {
  const problems = [];
  const entries = CLASSES.map((name) => classes[name]);
  const count = (list, field) => list.reduce((total, entry) => total + BigInt(entry[field]), 0n);
  const totalMeasures = count(entries, "measures");
  const totalAbsolute = sum(entries.map((entry) => entry.absolute));
  const shareOf = (part, total) => (compare(total, ZERO) === 0 ? ZERO : divide(part, total));
  const check = (label, entry) => {
    if (compare(entry.absolute, ZERO) < 0) problems.push(`${label}: its absolute value is negative`);
    if (!equals(entry.shareOfMeasures, shareOf(fraction(BigInt(entry.measures)), fraction(totalMeasures)))) {
      problems.push(`${label}: its share of measures is not its count over the event's`);
    }
    if (!equals(entry.shareOfAbsolute, shareOf(entry.absolute, totalAbsolute))) {
      problems.push(`${label}: its share of value is not its amount over the event's`);
    }
    for (const field of ["shareOfMeasures", "shareOfAbsolute"]) {
      if (compare(entry[field], ONE) > 0) problems.push(`${label}: its ${field === "shareOfMeasures" ? "measure" : "value"} share is above one`);
    }
    if (entry.net && compare(abs(entry.net), entry.absolute) > 0) {
      problems.push(`${label}: its net value is larger than its absolute value`);
    }
  };
  CLASSES.forEach((name) => check(name, classes[name]));
  Object.entries(gaps).forEach(([gap, entry]) => check(gap, entry));
  check(COMPUTED_ROW, computed);
  for (const [field, total] of [["shareOfMeasures", totalMeasures !== 0n], ["shareOfAbsolute", compare(totalAbsolute, ZERO) !== 0]]) {
    if (total && !equals(sum(entries.map((entry) => entry[field])), ONE)) {
      problems.push(`the classes' ${field === "shareOfMeasures" ? "measure" : "value"} shares do not sum to one`);
    }
  }
  // Compared even with no gap rows: the not-expressible class is then empty
  const gapEntries = Object.values(gaps);
  const own = classes.not_expressible;
  const counts = ["measures", "rows"].filter((field) => count(gapEntries, field) !== BigInt(own[field]));
  const amounts = ["net", "absolute", "shareOfAbsolute", "shareOfMeasures"].filter((field) => !equals(sum(gapEntries.map((entry) => entry[field])), own[field]));
  for (const field of [...counts, ...amounts]) problems.push(`the gap rows' ${field} do not add up to the not-expressible class`);
  // The replay computes only expressible or partly expressible measures.
  // Its computed rows and value are its constructed costing rows, each in
  // its own row's class (policyengine-scorecard computed_accounting), so
  // they are bounded by the event's rows and value, not by those classes'.
  if (BigInt(computed.measures) > count([classes.expressible, classes.partial], "measures")) {
    problems.push("more measures are computed than are expressible or partly expressible");
  }
  if (BigInt(computed.rows) > count(entries, "rows")) {
    problems.push("more costing rows are computed than the event has");
  }
  if (compare(computed.absolute, totalAbsolute) > 0) {
    problems.push("more value is computed than the event's costing holds");
  }
  return problems;
}

/** The measures the release does not model, each with its class and reason. */
export function parseNotModelled(text) {
  return records(text, NOT_MODELLED_HEADER, "not_modelled.csv").map((row) => {
    if (!CLASSES.includes(row.classification)) throw new HistoricalDataError(`not_modelled.csv has an unknown class ${JSON.stringify(row.classification)}`);
    if (row.gap_kind && !/^[a-z][a-z_]*$/.test(row.gap_kind)) throw new HistoricalDataError(`not_modelled.csv has an unknown gap kind ${JSON.stringify(row.gap_kind)}`);
    return {
      id: row.reform_id,
      name: row.reform_name,
      classification: row.classification,
      gap: row.gap_kind || null,
      reason: row.reason,
      rows: parseCount(row.rows),
      obrAbsolute: parseDecimal(row.obr_absolute_gbp),
    };
  });
}

/**
 * The not-modelled measures by class, and within the not-expressible class
 * by kind of gap, each group largest OBR value first.
 */
export function groupNotModelled(rows) {
  const groups = [];
  for (const name of CLASSES) {
    const members = rows.filter((row) => row.classification === name);
    const keys = name === "not_expressible" ? [...new Set(members.map((row) => row.gap))].sort() : [null];
    for (const gap of keys) {
      const items = members
        .filter((row) => name !== "not_expressible" || row.gap === gap)
        .sort((a, b) => compare(b.obrAbsolute, a.obrAbsolute) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (items.length) groups.push({ classification: name, gap, items });
    }
  }
  return groups;
}

const pounds = (text, name) => {
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new HistoricalDataError(`obr_comparison.csv has a value that is not a number in ${name}`);
  return value;
};

/**
 * The OBR's costing of each modelled measure by year, in £bn: of all its
 * heads, and of the heads PolicyEngine maps, beside the scorecard replay's
 * figure on the replay's own model and data (`pair`).
 */
export function parseHistoricalObr(text) {
  return records(text, OBR_HEADER, "obr_comparison.csv").map((row) => {
    if (!/^\d{4}$/.test(row.year)) throw new HistoricalDataError(`obr_comparison.csv has a bad year ${JSON.stringify(row.year)}`);
    const billions = (column) => {
      const value = pounds(row[column], column);
      return value === null ? null : value / 1e9;
    };
    return {
      id: row.reform_id,
      name: row.reform_name,
      year: Number(row.year),
      obr: billions("obr_gbp"),
      obrModelled: billions("obr_modelled_heads_gbp"),
      replay: billions("replay_policyengine_gbp"),
      pair: row.replay_pair,
    };
  });
}

/**
 * Whether every measure of the event is either in the release's manifest or
 * listed as not modelled, once: the coverage's measure count, and no id in
 * both.
 */
export function accountsForEveryMeasure(coverage, notModelled, manifestIds) {
  const total = CLASSES.reduce((count, name) => count + BigInt(coverage.classes[name].measures), 0n);
  const listed = new Set(notModelled.map((row) => row.id));
  return listed.size === notModelled.length && manifestIds.every((id) => !listed.has(id)) && BigInt(listed.size + new Set(manifestIds).size) === total;
}

/** The years a release's displayable measures are published for, in order. */
export function releaseYears(catalogue) {
  const years = new Set();
  for (const measure of catalogue.displayable) {
    for (const year of measure.years) if (!measure.unsupported_years.includes(year)) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/** An event's date, "2025-03-26", as "26 March 2025". */
export const eventDate = (date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/** The model and data a release's figures ran on, from its manifest. */
export function releasePair(manifest) {
  const identity = manifest?.execution?.identity;
  if (!identity?.model?.version || !identity?.data?.dataset) return null;
  const build = identity.data.build_id ? ` (build ${identity.data.build_id})` : "";
  return `${identity.model.name} ${identity.model.version}, ${identity.data.dataset}${build}`;
}

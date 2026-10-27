// The OBR's estimate of how a Budget's measures change CPI inflation, year
// by year: public/data/obr_cpi_policy_effect.json, written by hand on
// Budget day from the Economic and fiscal outlook's chart of the effect of
// policy measures on CPI inflation (docs/obr-cpi-policy-effect.md). It is
// the OBR's figure, not PolicyEngine's. Until the file is published the
// card is not drawn (a 404 is the normal state before the Budget).
//
// A file for an earlier Budget is drawn only when it says so
// (previous_budget: true), and the card's title then names that Budget and
// EFO, so last year's figures can be shown as a labelled preview but can
// never pass for this Budget's.

import { formatOneDp, round1 } from "./outlook";

export const OBR_CPI_EFFECT_FILE = "obr_cpi_policy_effect.json";
export const OBR_CPI_EFFECT_SCHEMA = "uk-budget-obr-cpi-policy-effect/v1";
// The Budget this dashboard is for
export const CURRENT_BUDGET = "Autumn Budget 2026";
export const OBR_CPI_EFFECT_TITLE = "Effect of the Budget's measures on CPI inflation (OBR)";

const BASES = { fiscal_years: /^\d{4}-\d{2}$/, calendar_years: /^\d{4}$/ };
// A measure's years must add up to the total to this much (the OBR's own
// chart data do, to rounding); more than this is a typing error
const SUM_TOLERANCE = 0.01;

const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";

/** [{ year, pp }] checked against the basis's year format; null when malformed. */
function yearRows(rows, pattern) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const out = [];
  for (const row of rows) {
    if (!isMap(row) || typeof row.year !== "string" || !pattern.test(row.year)) return null;
    if (typeof row.pp !== "number" || !Number.isFinite(row.pp)) return null;
    out.push({ year: row.year, pp: row.pp });
  }
  if (new Set(out.map((r) => r.year)).size !== out.length) return null;
  return out;
}

/**
 * The checked document, or null for anything that is not a well-formed
 * effect file for this Budget (or a labelled earlier one): the page then
 * draws nothing.
 *
 * Returns { budget, budgetDate, efo, efoUrl, sourceTable, sourceFile, page,
 * basis, years: [{ year, pp }], measures: [{ name, indirect, years }],
 * notes, previous }.
 */
export function parseObrCpiEffect(doc) {
  if (!isMap(doc) || doc.schema !== OBR_CPI_EFFECT_SCHEMA) return null;
  if (!isText(doc.budget) || !isText(doc.efo) || !isText(doc.source_table)) return null;
  const pattern = BASES[doc.basis];
  if (!pattern) return null;
  const previous = doc.budget !== CURRENT_BUDGET;
  // Another Budget's figures only as a labelled preview
  if (previous && doc.previous_budget !== true) return null;
  const years = yearRows(doc.years, pattern);
  if (!years) return null;
  let measures = [];
  if (doc.by_measure != null) {
    if (!Array.isArray(doc.by_measure)) return null;
    for (const m of doc.by_measure) {
      if (!isMap(m) || !isText(m.measure)) return null;
      const rows = yearRows(m.years, pattern);
      if (!rows || rows.length !== years.length || rows.some((r, i) => r.year !== years[i].year)) return null;
      measures.push({ name: m.measure, indirect: m.indirect === true, years: rows });
    }
    const sumsOff = years.some((y, i) => Math.abs(measures.reduce((s, m) => s + m.years[i].pp, 0) - y.pp) > SUM_TOLERANCE);
    if (measures.length && sumsOff) return null;
  }
  return {
    budget: doc.budget,
    budgetDate: isText(doc.budget_date) ? doc.budget_date : null,
    efo: doc.efo,
    efoUrl: isText(doc.efo_url) ? doc.efo_url : null,
    sourceTable: doc.source_table,
    sourceFile: isText(doc.source_file) ? doc.source_file : null,
    page: Number.isInteger(doc.page) ? doc.page : null,
    basis: doc.basis,
    years,
    measures,
    notes: Array.isArray(doc.notes) ? doc.notes.filter(isText) : [],
    previous,
  };
}

/** "November 2025" from "Economic and fiscal outlook, November 2025"; else the whole name. */
export function efoMonth(efo) {
  const match = /([A-Z][a-z]+ \d{4})\s*$/.exec(efo ?? "");
  return match ? match[1] : efo;
}

/** The card's title: plain for this Budget, naming the Budget and EFO for an earlier one. */
export function obrCpiEffectTitle(effect) {
  if (!effect?.previous) return OBR_CPI_EFFECT_TITLE;
  return `Effect of the Budget's measures on CPI inflation, ${effect.budget} (OBR, ${efoMonth(effect.efo)})`;
}

/** "fiscal years" or "calendar years". */
export const basisWords = (basis) => (basis === "calendar_years" ? "calendar years" : "fiscal years");

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// Rounded to the 0.1 points the OBR quotes, with no negative zero
const shown = (pp) => round1(pp) + 0;

/**
 * The card's one sentence, from the rounded figures: each run of
 * consecutive years with the same effect once, years that round to zero
 * left out. For Autumn Budget 2025: "The OBR estimates the Budget's
 * measures lower CPI inflation by 0.4 percentage points in 2026-27 and
 * raise it by 0.1 points in each of the next two years."
 */
export function obrCpiEffectSentence(years) {
  const rows = (years ?? []).map((r) => ({ year: r.year, v: shown(r.pp) }));
  if (!rows.length) return null;
  const groups = [];
  rows.forEach((r, i) => {
    if (r.v === 0) return;
    const last = groups[groups.length - 1];
    if (last && last.end === i - 1 && last.v === r.v) last.end = i;
    else groups.push({ v: r.v, start: i, end: i });
  });
  if (!groups.length) {
    return `The OBR estimates the Budget's measures change CPI inflation by less than 0.05 percentage points in every year from ${rows[0].year} to ${rows[rows.length - 1].year}.`;
  }
  const phrases = groups.map((g, i) => {
    const size = Math.abs(g.v);
    const unit = i === 0 ? (size === 1 ? "percentage point" : "percentage points") : size === 1 ? "point" : "points";
    const n = g.end - g.start + 1;
    let when;
    if (n === 1) when = `in ${rows[g.start].year}`;
    else if (i > 0 && groups[i - 1].end === g.start - 1 && NUMBER_WORDS[n]) when = `in each of the next ${NUMBER_WORDS[n]} years`;
    else when = `in each year from ${rows[g.start].year} to ${rows[g.end].year}`;
    return `${g.v < 0 ? "lower" : "raise"} ${i === 0 ? "CPI inflation" : "it"} by ${formatOneDp(size)} ${unit} ${when}`;
  });
  const list = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `The OBR estimates the Budget's measures ${list}.`;
}

/** Signed points for ticks and tooltips: "+0.1", "-0.4", "0.0". */
export function ppText(pp) {
  const v = shown(pp);
  return `${v > 0 ? "+" : ""}${formatOneDp(v)}`;
}

/**
 * The y axis in steps of 0.1 points (0.2 or 0.5 for larger effects),
 * always including zero, wide enough for every stacked part as well as the
 * totals.
 */
export function ppAxis(values) {
  const finite = values.filter(Number.isFinite);
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const span = hi - lo;
  const step = span > 2 ? 0.5 : span > 1 ? 0.2 : 0.1;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 10) / 10 + 0);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * The chart's rows: { year, total, m0, m1, ... } with each measure's
 * effect under its index key, and the stacked bars' extent per year.
 */
export function effectRows(effect) {
  return effect.years.map((y, i) => ({
    year: y.year,
    total: y.pp,
    ...Object.fromEntries(effect.measures.map((m, j) => [`m${j}`, m.years[i].pp])),
  }));
}

// The file, read once per page: { status: "ready", effect } or { status: "none" }
let cache = null;

/** For tests: forget the loaded file. */
export function clearObrCpiEffectCache() {
  cache = null;
}

/**
 * Fetch and check the file. Resolves { status: "none" } when it is not
 * published (404), unreadable or not for this Budget: the card is then
 * not drawn. Never rejects.
 */
export async function loadObrCpiEffect({ basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch } = {}) {
  if (cache) return cache;
  try {
    const response = await fetchImpl(`${basePath}/data/${OBR_CPI_EFFECT_FILE}`, { cache: "no-cache" });
    if (!response.ok) {
      cache = { status: "none" };
      return cache;
    }
    const effect = parseObrCpiEffect(await response.json());
    cache = effect ? { status: "ready", effect } : { status: "none" };
  } catch {
    cache = { status: "none" };
  }
  return cache;
}

/** The cached state, if the file has been read on this page. */
export const cachedObrCpiEffect = () => cache;

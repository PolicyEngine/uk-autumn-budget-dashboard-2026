// Loads public/data/obr_forecast_vintages.json for the OBR forecasts view,
// written by `uk-budget-data forecast-vintages`
// (src/uk_budget_data/forecast_vintages/; shape in
// data_inputs/forecast_vintages/README.md). The file holds only the OBR's
// forecasts and the ONS's outturn.

import { ROUNDING, periodIndex, periodKey } from "./transforms";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const FORECAST_VINTAGES_PATH = "/data/obr_forecast_vintages.json";

// The newest forecast the view shows. A file holding a later one is not
// drawn until that forecast has been checked and this is moved on.
export const NEWEST_SHOWN = { year: 2026, month: 3 };

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** How the page names a forecast: "March 2026". */
export const vintageLabel = ({ year, month }) => `${MONTHS[month - 1]} ${year}`;

const FREQUENCIES = ["calendar", "fiscal", "quarterly"];
const KINDS = ["growth", "index", "level"];
const KIND_WORDS = { growth: "growth rates", index: "an index", level: "levels" };
const UNITS = ["level", "index", "pct"];
const MEASURES = ["level", "share"];

// The most decimals a measure's figures are written with
const MAX_DECIMALS = 6;
// No figure in the file comes near this in its own units (the largest,
// house prices in pounds, is under 300,000), so a larger one is refused:
// then no sum, rate or axis drawn from the file can overflow
export const MAX_VALUE = 1e9;
// The years a period can fall in
const YEARS = [1900, 2100];
// Every figure and largest_gap is written to four decimals, so each is 0
// or at least ROUNDING in size; and no tolerance is finer. A figure finer
// than that is none the build wrote, and one far finer (1e-200) would
// underflow when a forecast is carried on or set against the outturn
// How far a forecast's figure for its launch period may sit from the
// outturn and still read as its kind (kindProblem). The launch period was
// over when the forecast was published (the launch rules), so that figure
// is an estimate of outturn, apart from today's only by revisions; the
// figures after it are forecasts, which may miss by any amount and are
// never set against the outturn. A level estimate is within half the
// outturn's largest size of it (the committed file's widest is 0.29, the
// PSNI in December 2013); a growth estimate within 10 points of the
// outturn's rate (widest 3.2, RHDI in March 2016); an index has one base,
// so its estimate's ratio to the outturn is the same in every forecast
// but for revisions, the largest within 1.5 times the smallest (widest
// 1.08). A growth rate is under 100% either way (widest 11.6).
const NEAR_LEVEL = 0.5;
const NEAR_GROWTH = 10;
const INDEX_SPREAD = 1.5;
const MAX_GROWTH = 100;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_VALUE;
const isText = (v) => typeof v === "string" && v.length > 0;
const textList = (v) => Array.isArray(v) && v.every(isText);
const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isId = (v) => typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(v);
// No control character, no space of any kind (what \s matches, written
// out so the build's _URL can say the same) and no quote or angle bracket
const isUrl = (v) =>
  typeof v === "string" && /^https:\/\/[^\x00-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"'<>]+$/.test(v);
const isSha = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
// A day the calendar has: Date.parse reads 30 February as 2 March
const isDate = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);
const oneOf = (list, v) => typeof v === "string" && list.includes(v);
const unique = (list) => new Set(list).size === list.length;
const absent = (v) => v === undefined || v === null;

/** Whether `key` is a period at `frequency`, written as the data writes it. */
function isPeriod(key, frequency) {
  if (!(isText(key) || Number.isInteger(key))) return false;
  try {
    const index = periodIndex(key, frequency);
    const year = frequency === "quarterly" ? Math.floor(index / 4) : index;
    return periodKey(index, frequency) === String(key) && year >= YEARS[0] && year <= YEARS[1];
  } catch {
    return false;
  }
}

// {period: value}: at least one period, every value a number in range and
// 0 or no finer than four decimals, as the build writes them, and no
// period missing between the first and the last (a value with no
// neighbour would be drawn as nothing). The build's series_as_read is
// held to the same cases (series.test.js)
const isFigure = (v) => isNumber(v) && (v === 0 || Math.abs(v) >= ROUNDING);
export function isSeries(values, frequency) {
  if (!isObject(values)) return false;
  const entries = Object.entries(values);
  if (!entries.length || !entries.every(([k, v]) => isPeriod(k, frequency) && isFigure(v))) return false;
  const periods = entries.map(([k]) => periodIndex(k, frequency)).sort((a, b) => a - b);
  return periods.every((t, i) => i === 0 || t === periods[i - 1] + 1);
}

function firstPeriod(values, frequency) {
  let first = Infinity;
  for (const k of Object.keys(values)) first = Math.min(first, periodIndex(k, frequency));
  return first;
}
const after = (a, b) => a.year > b.year || (a.year === b.year && a.month > b.month);
const same = (a, b) => a.year === b.year && a.month === b.month;

/**
 * The period a forecast published in `year` and `month` starts from, by
 * the file's launch rules (meta.launch_rules says each in words).
 */
export function launchPeriod(frequency, year, month) {
  if (frequency === "quarterly") return year * 4 + Math.floor((month - 1) / 3) - 2;
  if (frequency === "calendar") return year - 1;
  // Fiscal years run April to March: the last complete one before a
  // forecast published in March ended a year before that March
  return month >= 4 ? year - 1 : year - 2;
}

// The terms a measure's outturn check is in, as the build writes them: the
// measure's own units for a forecast of levels; growth rates for a growth
// forecast or an index, whose figures are not in the outturn's units
const checkTerms = (measure) => (measure.kind === "level" ? measure.unit : "% change on a year earlier");

/**
 * What the page reads from a measure's outturn check (checkSentence): the
 * periods it covers, in order and all in the outturn; its terms
 * (checkTerms); a tolerance and a largest gap the sentence can state
 * without contradicting itself, the gap within the tolerance as both are
 * written. A tolerance is a share of the value only where the gaps are in
 * the outturn's own units, the value's. Every measure has one: the build
 * writes one for each, and refuses to write one this refuses
 * (check_as_read in src/uk_budget_data/forecast_vintages/build.py), on the
 * cases in tests/fixtures/forecast_vintages_check_cases.json.
 */
export function checkProblem(check, measure, frequency) {
  if (absent(check)) return "it has no outturn check";
  const ok =
    isObject(check) &&
    isText(check.against) &&
    check.in === checkTerms(measure) &&
    Array.isArray(check.periods) &&
    check.periods.length > 0 &&
    check.periods.every((p) => isPeriod(p, frequency) && Object.hasOwn(measure.outturn, p)) &&
    check.periods.every((p, i) => i === 0 || periodIndex(p, frequency) > periodIndex(check.periods[i - 1], frequency)) &&
    typeof check.tolerance_is_share === "boolean" &&
    isNumber(check.tolerance) &&
    check.tolerance >= ROUNDING &&
    (!check.tolerance_is_share || (check.tolerance < 1 && measure.kind === "level")) &&
    isNumber(check.largest_gap) &&
    (check.largest_gap === 0 || Math.abs(check.largest_gap) >= ROUNDING) &&
    isPeriod(check.largest_gap_period, frequency) &&
    check.periods.includes(check.largest_gap_period);
  if (!ok) return "its outturn check is incomplete";
  const gap = Math.abs(check.largest_gap);
  // A share of the OBR's own figure, which is the outturn less the gap
  const within = check.tolerance_is_share
    ? gap <= check.tolerance * Math.abs(measure.outturn[check.largest_gap_period] - check.largest_gap)
    : gap <= check.tolerance;
  return within ? null : "its outturn check's largest gap is beyond its tolerance";
}

function vintageProblem(id, v, frequency, kind) {
  const dated =
    isObject(v) &&
    Number.isInteger(v.year) &&
    v.year >= YEARS[0] &&
    v.year <= YEARS[1] &&
    Number.isInteger(v.month) &&
    v.month >= 1 &&
    v.month <= 12;
  if (!dated) return `${id}: a forecast without its date`;
  if (after(v, NEWEST_SHOWN)) return "newer";
  if (!isId(v.id) || v.label !== vintageLabel(v)) return `${id}: a forecast not named for its date`;
  if (!isPeriod(v.launch, frequency) || periodIndex(v.launch, frequency) !== launchPeriod(frequency, v.year, v.month)) {
    return `${id}: the ${v.label} forecast's launch period does not follow the launch rules`;
  }
  if (!isSeries(v.values, frequency)) return `${id}: the ${v.label} forecast has no values`;
  // A line, as the build writes it: a forecast of one period is refused there
  if (Object.keys(v.values).length < 2) return `${id}: the ${v.label} forecast has only one value`;
  // It runs from its launch period, or the period after
  const launch = periodIndex(v.launch, frequency);
  const first = firstPeriod(v.values, frequency);
  if (first < launch || first > launch + 1 || (kind === "index" && first !== launch)) {
    return `${id}: the ${v.label} forecast does not start at its launch period`;
  }
  return null;
}

function measureProblem(id, name, measure, frequency) {
  if (!isObject(measure)) return `${id}: no ${name} measure`;
  if (!oneOf(KINDS, measure.kind)) return `${id}: unknown kind of forecast`;
  if (!isText(measure.unit) || !isText(measure.outturn_source) || !isText(measure.forecast_source)) {
    return `${id}: no unit or sources`;
  }
  if (!(Number.isInteger(measure.decimals) && measure.decimals >= 0 && measure.decimals <= MAX_DECIMALS)) {
    return `${id}: no decimals`;
  }
  // The files it is built from, each listed under Sources (filesProblem):
  // one OBR file or more, the ONS series, each once, and whether it reads
  // the House Price Index; its outturn is read from at least one of those
  const files = measure.files;
  if (
    !isObject(files) ||
    !textList(files.obr) ||
    !files.obr.length ||
    !unique(files.obr) ||
    !textList(files.ons) ||
    !unique(files.ons) ||
    typeof files.hpi !== "boolean" ||
    !(files.ons.length || files.hpi)
  ) {
    return `${id}: no list of the files it is built from`;
  }
  if (!isSeries(measure.outturn, frequency)) return `${id}: no outturn`;
  const check = checkProblem(measure.check, measure, frequency);
  if (check) return `${id}: ${check}`;
  if (!Array.isArray(measure.vintages) || !measure.vintages.length) return `${id}: no forecasts`;
  let previous = null;
  const ids = new Set();
  for (const v of measure.vintages) {
    const problem = vintageProblem(id, v, frequency, measure.kind);
    if (problem) return problem;
    if (ids.has(v.id)) return `${id}: the ${v.label} forecast twice`;
    ids.add(v.id);
    if (previous && !after(v, previous)) return `${id}: forecasts out of date order`;
    previous = v;
  }
  // The newest drawn is the newest shown: an older one is never promoted
  if (!same(previous, NEWEST_SHOWN)) return `${id}: its newest forecast is not the newest shown`;
  return kindProblem(id, measure, frequency);
}

/**
 * Whether a measure's forecasts read as its kind, where their figures can
 * say otherwise. Every figure: an index is above zero; a growth rate is
 * under 100% either way. Each forecast's figure for its launch period, an
 * estimate of outturn: a level's is near the outturn; a growth rate's near
 * the outturn's own rate; an index's ratio to the outturn is the same in
 * every forecast. At least one forecast's launch figure is set against the
 * outturn (the outturn has that period, and for a growth rate the one a
 * year before, above zero; for an index it is above zero), so the kind is
 * set against something. The build refuses to write a file this refuses
 * (check_kind in src/uk_budget_data/forecast_vintages/build.py), on the
 * cases in tests/fixtures/forecast_vintages_kind_cases.json.
 *
 * Where neither the figures nor the check can say, the kind is taken as
 * written. A forecast of levels, every figure above zero and each
 * forecast's launch figure near one share of the outturn, marked as an
 * index with its outturn check's terms changed to growth rates
 * (checkTerms), passes: an index is checked in growth rates, and no figure
 * in the file says the check's gaps are in other terms. It is then drawn
 * carried on from today's outturn, as an index is, not as published.
 */
export function kindProblem(id, measure, frequency) {
  const outturn = new Map(Object.entries(measure.outturn).map(([k, v]) => [periodIndex(k, frequency), v]));
  let size = 0;
  for (const v of outturn.values()) size = Math.max(size, Math.abs(v));
  const lag = frequency === "quarterly" ? 4 : 1;
  let compared = 0;
  let [low, high] = [Infinity, -Infinity];
  for (const v of measure.vintages) {
    const launch = periodIndex(v.launch, frequency);
    const values = new Map(Object.entries(v.values).map(([k, x]) => [periodIndex(k, frequency), x]));
    const all = [...values.values()];
    let reads =
      measure.kind === "index" ? all.every((x) => x > 0) : measure.kind === "growth" ? all.every((x) => Math.abs(x) < MAX_GROWTH) : true;
    const estimate = values.get(launch);
    const [now, before] = [outturn.get(launch), outturn.get(launch - lag)];
    // Set against the outturn only where the outturn has what it needs
    if (reads && estimate !== undefined) {
      if (measure.kind === "level" && now !== undefined) {
        compared += 1;
        reads = Math.abs(estimate - now) <= NEAR_LEVEL * size;
      }
      if (measure.kind === "growth" && now !== undefined && before > 0) {
        compared += 1;
        reads = Math.abs(estimate - 100 * (now / before - 1)) <= NEAR_GROWTH;
      }
      if (measure.kind === "index" && now > 0) {
        compared += 1;
        [low, high] = [Math.min(low, estimate / now), Math.max(high, estimate / now)];
      }
    }
    if (!reads) return `${id}: the ${v.label} forecast's figures do not read as ${KIND_WORDS[measure.kind]}`;
  }
  if (!compared) return `${id}: no forecast's launch figure meets the outturn to set its kind against`;
  if (high > INDEX_SPREAD * low) return `${id}: its forecasts do not read as one index`;
  return null;
}

function unitProblem(id, unit, spec, frequency) {
  if (!isObject(spec) || !isText(spec.label) || !isText(spec.axis) || !oneOf(MEASURES, spec.from)) {
    return `${id}: an incomplete unit`;
  }
  // Only % is a change on a year earlier, and only a quarterly measure's
  // £ is a quarter at an annual rate
  if (!absent(spec.transform) && !(spec.transform === "growth" && unit === "pct")) return `${id}: an unknown unit transform`;
  // An index or a % change is taken of the level, never of a share: its
  // axis (the page's own) says only that it is one
  if ((unit === "index" || spec.transform === "growth") && spec.from !== "level") return `${id}: its ${unit} unit is taken of no level`;
  if (!absent(spec.annualise) && typeof spec.annualise !== "boolean") return `${id}: an unknown unit transform`;
  // and it always is: its axis names a year, and its figures are a quarter's
  if (Boolean(spec.annualise) !== (unit === "level" && frequency === "quarterly")) {
    return `${id}: £ is at an annual rate only, and always, for a quarterly measure`;
  }
  return null;
}

// What the page reads from the file's meta, besides the forecasts
function metaProblem(meta, frequencies) {
  if (!isObject(meta)) return "no meta";
  const { parliament, launch_rules: rules, left_out: leftOut, gaps, sources } = meta;
  for (const f of frequencies) {
    if (!isObject(rules) || !isText(rules[f])) return "no launch rules";
  }
  // A quarterly measure's annual totals are calendar years
  const dated = frequencies.has("quarterly") ? new Set([...frequencies, "calendar"]) : frequencies;
  for (const f of dated) {
    const start = parliament?.start?.[f];
    const end = parliament?.end?.[f];
    if (!isPeriod(start, f) || !isPeriod(end, f) || periodIndex(start, f) >= periodIndex(end, f)) return "no parliament dates";
  }
  if (!Array.isArray(leftOut) || !leftOut.every((item) => isObject(item) && isText(item.what) && isText(item.why))) {
    return "no list of what is left out";
  }
  if (!unique(leftOut.map((item) => item.what))) return "no list of what is left out";
  if (!textList(gaps) || !unique(gaps)) return "no list of gaps";
  if (!isObject(sources)) return "no OBR sources";
  const { obr, ons, hpi } = sources;
  const obrOk = (s) => isObject(s) && isText(s.id) && isText(s.title) && isUrl(s.url) && (absent(s.archive_url) || isUrl(s.archive_url)) && isSha(s.sha256);
  if (!Array.isArray(obr) || !obr.length || !obr.every(obrOk) || !unique(obr.map((s) => s.id))) return "no OBR sources";
  const onsOk = (s) =>
    isObject(s) && isText(s.cdid) && isText(s.dataset) && isUrl(s.page) && isText(s.title) && isDate(s.release_date) && isSha(s.sha256);
  if (!Array.isArray(ons) || !ons.length || !ons.every(onsOk) || !unique(ons.map((s) => s.cdid))) return "no ONS sources";
  if (!absent(hpi) && !(isObject(hpi) && isUrl(hpi.page) && isText(hpi.title) && isSha(hpi.sha256))) {
    return "an incomplete House Price Index source";
  }
  return null;
}

function variableProblem(variable) {
  const id = isText(variable?.id) ? variable.id : "a variable";
  if (!isObject(variable) || !isId(variable.id) || !isText(variable.label) || !oneOf(FREQUENCIES, variable.frequency)) {
    return `${id}: no label or frequency`;
  }
  if (!absent(variable.notes) && !textList(variable.notes)) return `${id}: notes that are not text`;
  if (!isObject(variable.units)) return `${id}: unknown units`;
  const units = Object.entries(variable.units);
  if (!units.length || !units.every(([unit]) => UNITS.includes(unit))) return `${id}: unknown units`;
  for (const [unit, spec] of units) {
    const problem = unitProblem(id, unit, spec, variable.frequency);
    if (problem) return problem;
  }
  // Its own unit, named as the page names it, never a key it inherits
  if (!oneOf(UNITS, variable.default_unit) || !Object.hasOwn(variable.units, variable.default_unit)) {
    return `${id}: no default unit`;
  }
  for (const name of new Set(units.map(([, spec]) => spec.from))) {
    const problem = measureProblem(id, name, variable[name], variable.frequency);
    if (problem) return problem;
  }
  // A unit says what its figures are: a % shown as published reads a
  // measure in %, a % change one that is not (a rate's change on a year
  // earlier is no rate, whatever its axis says), and £ or people never
  // read one
  for (const [unit, spec] of units) {
    const inPct = variable[spec.from].unit.startsWith("%");
    if ((unit === "pct" && (spec.transform === "growth") === inPct) || (unit === "level" && inPct)) {
      return `${id}: its ${unit} unit reads a measure in other units`;
    }
  }
  return null;
}

/**
 * Why the file cannot be shown, or null. Every field the page reads is
 * checked here, by type and by the values the page can draw truly: a
 * file that passes cannot fail as it is drawn, and what it says of itself
 * (each forecast's name and launch period, its outturn check) agrees with
 * its figures. "newer" means it holds a forecast after the newest this
 * view shows.
 */
export function forecastVintagesProblem(data) {
  if (!isObject(data)) return "not a forecast vintages file";
  if (!Array.isArray(data.variables) || !data.variables.length) return "no variables";
  let found = null;
  for (const variable of data.variables) {
    const problem = variableProblem(variable);
    // A newer forecast anywhere is said as such, whatever else is wrong
    if (problem === "newer") return "newer";
    found ??= problem;
  }
  if (found) return found;
  const ids = data.variables.map((v) => v.id);
  if (!unique(ids)) return "a variable twice";
  return metaProblem(data.meta, new Set(data.variables.map((v) => v.frequency))) ?? filesProblem(data);
}

// Every file a measure drawn is built from is listed under Sources, as
// each card says. Called once the variables and meta are taken
function filesProblem(data) {
  const { obr, ons, hpi } = data.meta.sources;
  const obrIds = new Set(obr.map((s) => s.id));
  const cdids = new Set(ons.map((s) => s.cdid));
  for (const v of data.variables) {
    for (const name of new Set(Object.values(v.units).map((spec) => spec.from))) {
      const { files } = v[name];
      if (!files.obr.every((f) => obrIds.has(f)) || !files.ons.every((f) => cdids.has(f)) || (files.hpi && absent(hpi))) {
        return `${v.id}: a file it is built from is not among the sources`;
      }
    }
  }
  return null;
}

/**
 * The earliest forecast the page draws from the file, as it names it:
 * from the measures a unit reads, the only ones the loader checks.
 */
export function earliestForecast(data) {
  const firsts = data.variables.flatMap((v) =>
    [...new Set(Object.values(v.units).map((spec) => spec.from))].map((name) => v[name].vintages[0]),
  );
  return vintageLabel(firsts.reduce((a, b) => (after(a, b) ? b : a)));
}

let cached = null;

/**
 * Load the file once per page. Returns { data, error, newer }. A missing,
 * unreadable or malformed file is an error, never placeholder numbers;
 * `newer` is set when the file holds a forecast this view does not show yet.
 */
export function loadForecastVintages() {
  if (!cached) {
    cached = fetch(`${BASE}${FORECAST_VINTAGES_PATH}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${FORECAST_VINTAGES_PATH}: HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const problem = forecastVintagesProblem(data);
        if (problem === "newer") return { data: null, error: null, newer: true };
        if (problem) throw new Error(`${FORECAST_VINTAGES_PATH}: ${problem}`);
        return { data, error: null, newer: false };
      })
      .catch((error) => {
        cached = null;
        return { data: null, error: error.message, newer: false };
      });
  }
  return cached;
}

/** For tests: forget the loaded file. */
export function resetForecastVintages() {
  cached = null;
}

// Loads public/data/obr_forecast_vintages.json for the OBR forecasts view,
// written by `uk-budget-data forecast-vintages`
// (src/uk_budget_data/forecast_vintages/; shape in
// data_inputs/forecast_vintages/README.md). The file holds only the OBR's
// forecasts and the ONS's outturn.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const FORECAST_VINTAGES_PATH = "/data/obr_forecast_vintages.json";

// The newest forecast the view shows. A file holding a later one is not
// drawn until that forecast has been checked and this is moved on.
export const NEWEST_SHOWN = { year: 2026, month: 3 };

const FREQUENCIES = new Set(["calendar", "fiscal", "quarterly"]);
const KINDS = new Set(["growth", "index", "level"]);
const UNITS = new Set(["level", "index", "pct"]);
const MEASURES = new Set(["level", "share"]);

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isText = (v) => typeof v === "string" && v.length > 0;
const isPeriod = (v) => isText(v) || Number.isInteger(v);
const textList = (v) => Array.isArray(v) && v.every(isText);
const numbers = (values) =>
  values && typeof values === "object" && Object.keys(values).length > 0 && Object.values(values).every(isNumber);
const after = (a, b) => a.year > b.year || (a.year === b.year && a.month > b.month);
const same = (a, b) => a.year === b.year && a.month === b.month;

// What the page reads from a measure's outturn check (checkSentence)
function checkProblem(check) {
  if (check == null) return null;
  const ok =
    isText(check.against) &&
    isText(check.in) &&
    Array.isArray(check.periods) &&
    check.periods.every(isPeriod) &&
    isNumber(check.tolerance) &&
    isNumber(check.largest_gap) &&
    isPeriod(check.largest_gap_period);
  return ok ? null : "its outturn check is incomplete";
}

function measureProblem(id, name, measure) {
  if (!measure || typeof measure !== "object") return `${id}: no ${name} measure`;
  if (!KINDS.has(measure.kind)) return `${id}: unknown kind of forecast`;
  if (!isText(measure.unit) || !isText(measure.outturn_source) || !isText(measure.forecast_source)) {
    return `${id}: no unit or sources`;
  }
  if (!Number.isInteger(measure.decimals)) return `${id}: no decimals`;
  const check = checkProblem(measure.check);
  if (check) return `${id}: ${check}`;
  if (!numbers(measure.outturn)) return `${id}: no outturn`;
  if (!Array.isArray(measure.vintages) || !measure.vintages.length) return `${id}: no forecasts`;
  let previous = null;
  for (const v of measure.vintages) {
    if (!(Number.isInteger(v.year) && Number.isInteger(v.month) && isPeriod(v.launch) && isText(v.id) && isText(v.label))) {
      return `${id}: a forecast without its date`;
    }
    if (!numbers(v.values)) return `${id}: the ${v.label} forecast has no values`;
    if (after(v, NEWEST_SHOWN)) return "newer";
    if (previous && !after(v, previous)) return `${id}: forecasts out of date order`;
    previous = v;
  }
  // The newest drawn is the newest shown: an older one is never promoted
  if (!same(previous, NEWEST_SHOWN)) return `${id}: its newest forecast is not the newest shown`;
  return null;
}

// What the page reads from the file's meta, besides the forecasts
function metaProblem(meta, frequencies) {
  if (!meta || typeof meta !== "object") return "no meta";
  const { parliament, launch_rules: rules, left_out: leftOut, gaps, sources } = meta;
  for (const f of frequencies) {
    if (!isPeriod(parliament?.start?.[f]) || !isPeriod(parliament?.end?.[f])) return "no parliament dates";
    if (!isText(rules?.[f])) return "no launch rules";
  }
  if (!Array.isArray(leftOut) || !leftOut.every((item) => isText(item?.what) && isText(item?.why))) {
    return "no list of what is left out";
  }
  if (!textList(gaps)) return "no list of gaps";
  const obr = sources?.obr;
  const ons = sources?.ons;
  if (!Array.isArray(obr) || !obr.length || !obr.every((s) => isText(s?.id) && isText(s?.title) && isText(s?.url) && isText(s?.sha256))) {
    return "no OBR sources";
  }
  if (
    !Array.isArray(ons) ||
    !ons.length ||
    !ons.every((s) => isText(s?.cdid) && isText(s?.dataset) && isText(s?.page) && isText(s?.title) && isText(s?.release_date) && isText(s?.sha256))
  ) {
    return "no ONS sources";
  }
  if (sources.hpi != null && !(isText(sources.hpi.page) && isText(sources.hpi.title) && isText(sources.hpi.sha256))) {
    return "an incomplete House Price Index source";
  }
  return null;
}

function variableProblem(variable) {
  const id = variable?.id ?? "a variable";
  if (!isText(variable?.id) || !isText(variable?.label) || !FREQUENCIES.has(variable.frequency)) {
    return `${id}: no label or frequency`;
  }
  if (variable.notes != null && !textList(variable.notes)) return `${id}: notes that are not text`;
  const units = Object.entries(variable.units || {});
  if (!units.length || !units.every(([unit]) => UNITS.has(unit))) return `${id}: unknown units`;
  for (const [, spec] of units) {
    if (!isText(spec?.label) || !isText(spec?.axis) || !MEASURES.has(spec.from)) return `${id}: an incomplete unit`;
    if (spec.transform != null && spec.transform !== "growth") return `${id}: an unknown unit transform`;
  }
  if (!variable.units[variable.default_unit]) return `${id}: no default unit`;
  for (const name of new Set(units.map(([, spec]) => spec.from))) {
    const problem = measureProblem(id, name, variable[name]);
    if (problem) return problem;
  }
  return null;
}

/**
 * Why the file cannot be shown, or null: every field the page reads is
 * checked here, so a file that passes cannot fail as it is drawn. "newer"
 * means it holds a forecast after the newest this view shows.
 */
export function forecastVintagesProblem(data) {
  if (!data || typeof data !== "object") return "not a forecast vintages file";
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
  if (new Set(ids).size !== ids.length) return "a variable twice";
  return metaProblem(data.meta, new Set(data.variables.map((v) => v.frequency)));
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

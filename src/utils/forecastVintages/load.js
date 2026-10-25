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

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const numbers = (values) =>
  values && typeof values === "object" && Object.keys(values).length > 0 && Object.values(values).every(isNumber);
const after = (a, b) => a.year > b.year || (a.year === b.year && a.month > b.month);

function measureProblem(id, name, measure) {
  if (!measure || typeof measure !== "object") return `${id}: no ${name} measure`;
  if (!KINDS.has(measure.kind)) return `${id}: unknown kind of forecast`;
  if (!numbers(measure.outturn)) return `${id}: no outturn`;
  if (!Array.isArray(measure.vintages) || !measure.vintages.length) return `${id}: no forecasts`;
  for (const v of measure.vintages) {
    if (!(Number.isInteger(v.year) && Number.isInteger(v.month) && v.launch && v.id)) return `${id}: a forecast without its date`;
    if (!numbers(v.values)) return `${id}: the ${v.label} forecast has no values`;
    if (after(v, NEWEST_SHOWN)) return "newer";
  }
  return null;
}

/**
 * Why the file cannot be shown, or null. "newer" means it holds a forecast
 * after the newest this view shows.
 */
export function forecastVintagesProblem(data) {
  if (!data || typeof data !== "object") return "not a forecast vintages file";
  const parliament = data.meta?.parliament;
  if (!parliament?.start || !parliament?.end) return "no parliament dates";
  if (!Array.isArray(data.variables) || !data.variables.length) return "no variables";
  for (const variable of data.variables) {
    const id = variable?.id ?? "a variable";
    if (!variable?.label || !FREQUENCIES.has(variable.frequency)) return `${id}: no label or frequency`;
    const units = Object.entries(variable.units || {});
    if (!units.length || !units.every(([unit]) => UNITS.has(unit))) return `${id}: unknown units`;
    if (!variable.units[variable.default_unit]) return `${id}: no default unit`;
    for (const name of new Set(units.map(([, spec]) => spec.from))) {
      const problem = measureProblem(id, name, variable[name]);
      if (problem) return problem;
    }
  }
  return null;
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

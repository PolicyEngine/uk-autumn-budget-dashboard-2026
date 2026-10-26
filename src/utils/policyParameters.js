/**
 * The Policies cards' "What changes" tables: each measure's policy
 * parameters, current law beside the measure, read from the model by
 * `uk-budget-data policy-table` (public/data/policy_parameters.json; see
 * src/uk_budget_data/policy_table.py). The page keeps no figures or measure
 * list of its own here: it joins the file to the catalogue by id, and shows
 * a measure's table only while the published measure has the description
 * the table was built from, so a measure changed since (on Budget day, say)
 * never shows figures that may no longer describe it.
 */

export const POLICY_PARAMETERS_FILE = "policy_parameters.json";
export const POLICY_PARAMETERS_SCHEMA = "uk-budget-dashboard/policy-parameters/v1";

// Lines a collapsed table shows before "Show all years"
export const COLLAPSED_LINES = 3;

const UNIT_NAMES = {
  percent: "rate",
  gbp: "pounds",
  pence_per_litre: "pence a litre",
};

/** The unit in words, for a row's heading. */
export const unitName = (unit) => UNIT_NAMES[unit] ?? "";

const MINUS = "−";

const trimmed = (value, digits) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** A value in its unit: "5%", "52.95p", "£30,267"; none is "None". */
export function formatValue(value, unit) {
  if (value === null || value === undefined) return "None";
  if (unit === "percent") return `${trimmed(value * 100, 2)}%`;
  if (unit === "pence_per_litre") return `${value.toFixed(2)}p`;
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** The change from current law, signed: "−5pp", "−3p", "+£882". */
export function formatChange(before, after, unit) {
  if (before === null || before === undefined) return "New";
  if (after === null || after === undefined) return "Removed";
  const delta = after - before;
  if (Math.abs(delta) < 1e-9) return "No change";
  const sign = delta > 0 ? "+" : MINUS;
  const size = Math.abs(delta);
  if (unit === "percent") return `${sign}${trimmed(size * 100, 2)}pp`;
  if (unit === "pence_per_litre") return `${sign}${trimmed(size, 2)}p`;
  return `${sign}£${Math.round(size).toLocaleString("en-GB")}`;
}

const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
export const differs = (point) => !same(point.before, point.after);

/**
 * A measure's table, or null: none unless the file describes the measure
 * exactly as the publication now does.
 */
export function parameterTableFor(tables, policy) {
  const table = tables?.measures?.[policy?.id];
  if (!table || table.description !== policy.description) return null;
  return Array.isArray(table.rows) && table.rows.length ? table.rows : null;
}

const line = (point) => ({
  key: point.key,
  label: point.label,
  from: point.year,
  to: point.year,
  before: point.before,
  after: point.after,
});

/**
 * Consecutive years with the same change, as one line ("2027-28 to
 * 2031-32"), so a lasting change reads once.
 */
export function mergeRuns(points) {
  const lines = [];
  for (const point of points) {
    const last = lines[lines.length - 1];
    const yearly = /^\d{4}$/.test(point.key);
    if (
      last?.yearly && yearly && last.to + 1 === point.year &&
      same(last.before, point.before) && same(last.after, point.after)
    ) {
      last.to = point.year;
      last.key = `${last.key.split("..")[0]}..${point.key}`;
      last.label = `${last.firstLabel} to ${point.label}`;
    } else {
      lines.push({ ...line(point), yearly, firstLabel: point.label });
    }
  }
  return lines.map(({ yearly: _yearly, firstLabel: _first, ...rest }) => rest);
}

/**
 * What a table shows. Collapsed: the primary rows, each only where the
 * measure differs from current law, runs of the same change as one line,
 * at most COLLAPSED_LINES lines (each primary row keeps its first). All
 * years: every row and every year. `more` says whether "Show all years"
 * would show anything else.
 */
export function visibleRows(rows, { expanded = false } = {}) {
  const all = rows.map((row) => ({ ...row, lines: row.points.map(line) }));
  const primary = rows
    .filter((row) => row.primary)
    .map((row) => ({ ...row, lines: mergeRuns(row.points.filter(differs)) }))
    .filter((row) => row.lines.length);
  let budget = COLLAPSED_LINES - primary.length;
  const collapsed = primary.map((row) => {
    const extra = Math.max(Math.min(row.lines.length - 1, budget), 0);
    budget -= extra;
    return { ...row, lines: row.lines.slice(0, 1 + extra) };
  });
  const shown = (list) => list.reduce((count, row) => count + row.lines.length, 0);
  const more = shown(all) > shown(collapsed);
  return { rows: expanded ? all : collapsed, more };
}

/** The sparkline's points for a row, scaled to a width and height. */
export function sparkline(points, { width = 64, height = 20, pad = 2 } = {}) {
  const values = points.flatMap((p) => [p.before, p.after]).filter((v) => v !== null && v !== undefined);
  if (points.length < 3 || !values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const x = (i) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v) => height - pad - ((v - low) / span) * (height - 2 * pad);
  const path = (key) =>
    points
      .map((p, i) => (p[key] === null || p[key] === undefined ? null : `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  return {
    width,
    height,
    before: path("before"),
    after: path("after"),
    xs: points.map((p, i) => ({ year: p.year, x: x(i) })),
  };
}

let cached;

/** The file, once per page; null when it is missing or of another schema. */
export function loadPolicyParameters({ fetchImpl = globalThis.fetch, base = process.env.NEXT_PUBLIC_BASE_PATH || "" } = {}) {
  if (!cached) {
    cached = Promise.resolve()
      .then(() => fetchImpl(`${base}/data/${POLICY_PARAMETERS_FILE}`))
      .then((response) => (response?.ok ? response.json() : null))
      .then((document) => (document?.schema === POLICY_PARAMETERS_SCHEMA ? document : null))
      .catch(() => null);
  }
  return cached;
}

/** For tests: forget the loaded file. */
export function resetPolicyParameters() {
  cached = undefined;
}

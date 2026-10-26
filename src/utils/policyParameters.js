/**
 * The Policies cards' "What changes" plots: each measure's policy
 * parameters, current law beside the measure, read from the model by
 * `uk-budget-data policy-table` (public/data/policy_parameters.json; see
 * src/uk_budget_data/policy_table.py). The page keeps no figures or measure
 * list of its own here: it joins the file to the catalogue by id, and shows
 * a measure's plot only while the published measure has the description
 * the file was built from, so a measure changed since (on Budget day, say)
 * never shows figures that may no longer describe it.
 */

export const POLICY_PARAMETERS_FILE = "policy_parameters.json";
export const POLICY_PARAMETERS_SCHEMA = "uk-budget-dashboard/policy-parameters/v1";

// The page's timeline: April 2026 to March 2032, in months
export const FIRST_YEAR = 2026;
export const MONTHS = 72;

const MINUS = "−";
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const trimmed = (value, digits) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** A value in its unit: "5%", "52.95p", "£30,267"; none is "none". */
export function formatValue(value, unit) {
  if (value === null || value === undefined) return "none";
  if (unit === "percent") return `${trimmed(value * 100, 2)}%`;
  if (unit === "pence_per_litre") return `${value.toFixed(2)}p`;
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** The size of a change, unsigned, in its unit: "£1,130", "6.8p". */
export function formatSize(before, after, unit) {
  const size = Math.abs((after ?? 0) - (before ?? 0));
  if (unit === "pence_per_litre") return `${trimmed(size, 2)}p`;
  return `£${Math.round(size).toLocaleString("en-GB")}`;
}

/**
 * The change from current law: signed for an amount ("+£1,130", "−3p");
 * for a rate, the two rates ("15% → 0%"), never percentage points.
 */
export function formatChange(before, after, unit) {
  if (same(before, after)) return "no change";
  if (unit === "percent" || before === null || before === undefined) {
    return `${formatValue(before, unit)} → ${formatValue(after, unit)}`;
  }
  return `${after > before ? "+" : MINUS}${formatSize(before, after, unit)}`;
}

const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
export const differs = (item) => !same(item.before, item.after);

/**
 * A measure's rows, or null: none unless the file describes the measure
 * exactly as the publication now does.
 */
export function parameterTableFor(tables, policy) {
  const table = tables?.measures?.[policy?.id];
  if (!table || table.description !== policy.description) return null;
  return Array.isArray(table.rows) && table.rows.length ? table.rows : null;
}

// --- Time ------------------------------------------------------------------

/** "2027-01-01" as months since 1 April 2026, with days as a fraction. */
export function monthOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (year - FIRST_YEAR) * 12 + (month - 4) + (day - 1) / days;
}

const clamp = (month) => Math.min(Math.max(month, 0), MONTHS);
const monthLabel = (isoDate) => {
  const [year, month] = isoDate.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};
const nextDay = (isoDate) => {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};
const yearOfMonth = (month) => FIRST_YEAR + Math.floor(Math.min(month, MONTHS - 1e-6) / 12);

const isYearly = (point) => /^\d{4}$/.test(point.key);
const isDated = (point) => /^\d{4}-\d{2}-\d{2}$/.test(point.key);
const isWindow = (point) => /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(point.key);

/**
 * A row as steps on the timeline: each with its months, the two values,
 * a label for when it applies, and the years it covers (for the card's
 * timeline). By year (April to March), from each dated change, or a rate
 * in force for a window, back to current law either side.
 */
export function segmentsFor(row) {
  const points = row.points ?? [];
  let segments = [];
  if (points.length === 1 && isWindow(points[0])) {
    const [point] = points;
    const [first, last] = point.key.split("/");
    const start = clamp(monthOf(first));
    const end = clamp(monthOf(nextDay(last)));
    segments = [
      { start: 0, end: start, before: point.before, after: point.before, label: `Before ${monthLabel(first)}` },
      { start, end, before: point.before, after: point.after, label: point.label },
      { start: end, end: MONTHS, before: point.before, after: point.before, label: `After ${monthLabel(last)}` },
    ];
  } else if (points.length && points.every(isDated)) {
    const sorted = [...points].sort((a, b) => a.key.localeCompare(b.key));
    segments = sorted.map((point, i) => ({
      start: clamp(monthOf(point.key)),
      end: i + 1 < sorted.length ? clamp(monthOf(sorted[i + 1].key)) : MONTHS,
      before: point.before,
      after: point.after,
      label: `From ${point.label}`,
    }));
  } else if (points.length && points.every(isYearly)) {
    segments = points.map((point) => ({
      start: clamp((point.year - FIRST_YEAR) * 12),
      end: clamp((point.year - FIRST_YEAR + 1) * 12),
      before: point.before,
      after: point.after,
      label: point.label,
    }));
  }
  return segments
    .filter((segment) => segment.end > segment.start)
    .map((segment) => ({ ...segment, from: yearOfMonth(segment.start), to: yearOfMonth(segment.end - 1e-6) }));
}

/**
 * How a row reads best. A single change that holds from when it starts
 * (current law one value throughout, the measure another) is a pair:
 * before and after, to scale. Anything that moves over time is a plot.
 */
export function visualFor(row) {
  const points = row.points ?? [];
  const changed = points.filter(differs);
  if (!changed.length) return null;
  if (points.length === 1 && !isWindow(points[0])) {
    return { kind: "pair", before: points[0].before, after: points[0].after, when: points[0].label };
  }
  if (points.every(isYearly)) {
    const first = points.indexOf(changed[0]);
    const flat = points.every((p) => same(p.before, points[0].before));
    const held = points.slice(first).every((p) => differs(p) && same(p.after, changed[0].after));
    if (flat && held) {
      return { kind: "pair", before: changed[0].before, after: changed[0].after, when: `from ${changed[0].label}` };
    }
  }
  const segments = segmentsFor(row);
  return segments.length ? { kind: "plot", segments } : null;
}

// --- Words -----------------------------------------------------------------

const periodWords = (segment) =>
  /^(From|Before|After) /.test(segment.label) ? segment.label.replace(/^From/, "from") : `in ${segment.label}`;

const direction = (segment) => (segment.after > segment.before ? "higher" : "lower");

/**
 * One line on what a row's change is, stated once: for a plot, its first
 * gap, its largest if that is another, and its latest; for a pair, from
 * what to what.
 */
export function summaryFor(row) {
  const visual = visualFor(row);
  if (!visual) return "";
  const { unit } = row;
  const { label } = row;
  if (visual.kind === "pair") {
    const verb = visual.after > visual.before ? "rises" : "falls";
    return `${label} ${verb} from ${formatValue(visual.before, unit)} to ${formatValue(visual.after, unit)} ${visual.when.startsWith("from") ? visual.when : `for ${visual.when.toLowerCase()}`}.`;
  }
  const gaps = visual.segments.filter(differs);
  if (unit === "percent") {
    // A rate reads as the two rates while it applies
    return gaps
      .map((g) => `${label} is ${formatValue(g.after, unit)} instead of ${formatValue(g.before, unit)} ${g.label.match(/^\D+ \d{4} to /) ? `from ${g.label}` : periodWords(g)}.`)
      .join(" ");
  }
  const size = (g) => Math.abs(g.after - g.before);
  const first = gaps[0];
  const last = gaps[gaps.length - 1];
  const largest = gaps.reduce((big, g) => (size(g) > size(big) + 1e-9 ? g : big), first);
  const words = (g) => `${formatSize(g.before, g.after, unit)} ${direction(g)}`;
  let text = `${label} is ${words(first)} than under current law ${periodWords(first)}`;
  if (gaps.length === 1) return `${text}.`;
  if (largest !== first && largest !== last) text += `, up to ${words(largest)} ${periodWords(largest)}`;
  if (same(size(last), size(first)) && largest === first) {
    return `${text}, through ${last.label.replace(/^From /, "")}.`;
  }
  return `${text}, and ${words(last)} ${periodWords(last).replace(/^in /, "by ").replace(/^from /, "from ")}.`;
}

/** A step in words, for the plot's tooltip and its text alternative. */
export function describeSegment(segment, unit) {
  if (!differs(segment)) return `${segment.label}: ${formatValue(segment.before, unit)}, as under current law`;
  if (unit === "percent") return `${segment.label}: ${formatChange(segment.before, segment.after, unit)}`;
  return `${segment.label}: ${formatValue(segment.before, unit)} → ${formatValue(segment.after, unit)} (${formatChange(segment.before, segment.after, unit)})`;
}

// --- Loading ---------------------------------------------------------------

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

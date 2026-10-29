/**
 * The numbers behind each modelled measure's card visual (components/
 * policies/PolicyVisual.jsx), read from the measure's entry in
 * public/data/policy_parameters.json and from its card details
 * (policyDetails.js `visual`, whose figures are those of the entry's
 * `writtenFor` and `example`, checked by policyVisuals.test.js). Nothing
 * is typed here: every function returns null where its data are missing
 * or do not agree, and the card then shows no visual rather than a wrong one.
 */
import { differs, mainRow, monthOf } from "./policyParameters";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2027-01" (or "2027-01-01") as { year, month } (month 1 to 12). */
const parts = (iso) => {
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
};

/** Months from one "YYYY-MM" to another, the first counted as 0. */
export const monthsBetween = (from, to) => {
  const a = parts(from);
  const b = parts(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
};

/** The "YYYY-MM" month `offset` months after `from`. */
export const addMonths = (from, offset) => {
  const { year, month } = parts(from);
  const index = year * 12 + month - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

/** "Jan", or "Jan 2027" with the year. */
export const shortMonth = (iso, withYear = false) => {
  const { year, month } = parts(iso);
  return withYear ? `${MONTH_SHORT[month - 1]} ${year}` : MONTH_SHORT[month - 1];
};

/** "January 2027". */
export const longMonth = (iso) => {
  const { year, month } = parts(iso);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};

/** "£1.50", "£3.82": an amount in pounds and pence. */
export const pounds = (value) => `£${value.toFixed(2)}`;

/** "£13,036": whole pounds. */
export const wholePounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;

/** "24%": a rate held as a share. */
export const percent = (share) => `${Math.round(share * 1000) / 10}%`;

// --- Fuel duty ------------------------------------------------------------------

/**
 * Fuel duty around the cut: current law's and the measure's rates over the
 * months the visual shows (`window`, "YYYY-MM" to "YYYY-MM", both shown),
 * and each period the measure differs, with the duty saved on a fill of
 * `litres` litres (the gap in pence a litre times the litres). Duty only:
 * the file carries no VAT rate for this measure.
 */
export function fuelDutyView(entry, visual) {
  const row = mainRow(entry);
  if (!row || row.unit !== "pence_per_litre" || !visual?.window || !visual?.litres) return null;
  const points = [...row.points].filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.key)).sort((a, b) => a.key.localeCompare(b.key));
  if (points.length < 2) return null;
  const start = monthOf(`${visual.window.from}-01`);
  const end = monthOf(`${addMonths(visual.window.to, 1)}-01`);
  // Each rate from its date to the next, cut to the window
  const steps = points
    .map((point, i) => ({
      key: point.key,
      start: Math.max(monthOf(point.key), start),
      end: Math.min(i + 1 < points.length ? monthOf(points[i + 1].key) : end, end),
      before: point.before,
      after: point.after,
    }))
    .filter((step) => step.end > step.start);
  const cuts = points
    .map((point, i) => ({ point, next: points[i + 1] }))
    .filter(({ point }) => differs(point))
    .map(({ point, next }) => {
      const gap = point.before - point.after;
      const first = point.key.slice(0, 7);
      // The last month the rate holds: the month before the next date
      const last = next ? addMonths(next.key.slice(0, 7), -1) : first;
      return {
        key: point.key,
        first,
        last,
        months: first === last ? shortMonth(first, true) : `${shortMonth(first)} to ${shortMonth(last, true)}`,
        before: point.before,
        after: point.after,
        gap,
        fill: (gap * visual.litres) / 100,
      };
    });
  if (!cuts.length || cuts.some((cut) => cut.gap <= 0)) return null;
  const rates = steps.flatMap((step) => [step.before, step.after]);
  return {
    unit: row.unit_words ?? "pence a litre",
    litres: visual.litres,
    window: visual.window,
    start,
    end,
    steps,
    cuts,
    low: Math.min(...rates),
    high: Math.max(...rates),
    largest: cuts.reduce((big, cut) => (cut.gap > big.gap ? cut : big), cuts[0]),
  };
}

// --- Carer's Allowance -----------------------------------------------------

const LIMIT = /earnings limit is[^£]*£([\d,]+) a week in (\d{4}-\d{2})/;
const RUNS_OUT = /runs out at £([\d,]+) a week in (\d{4}-\d{2})/;
const number = (text) => Number(text.replace(/,/g, ""));

/**
 * The allowance against weekly earnings in the first year of the taper:
 * the earnings limit and where the tapered allowance runs out (the row's
 * card_note, which the generator writes from the model's parameters), and
 * the full weekly rate (the row gives the allowance at £1 over the limit,
 * the rate less £1). Null unless the three agree: limit + rate is where it
 * runs out, to the pound the note rounds to.
 */
export function carersTaperView(entry) {
  const row = mainRow(entry);
  const note = row?.card_note;
  if (!row || !note) return null;
  const limit = LIMIT.exec(note);
  const runs = RUNS_OUT.exec(note);
  if (!limit || !runs || limit[2] !== runs[2]) return null;
  const year = limit[2];
  const point = row.points.find((p) => p.label === year);
  if (!point || !(point.after > 0) || point.before !== 0) return null;
  const rate = Math.round((point.after + 1) * 100) / 100;
  const view = { year, limit: number(limit[1]), runsOut: number(runs[1]), rate, note };
  if (Math.abs(view.limit + view.rate - view.runsOut) > 1) return null;
  return view;
}

// --- Household Energy Payment ---------------------------------------------

/**
 * Who the payment reaches: the payment and the bands paid (the row's note,
 * "bands A, B, C, D"), England's bands (`visual.bands`), and the reach the
 * Budget states (`visual.reach`: the share of all households, and of two
 * groups). England's households in all, about, is the number reached over
 * its share, rounded to the million.
 */
export function energyReachView(entry, visual) {
  const row = mainRow(entry);
  const point = row?.points?.[0];
  const paid = /bands ([A-H](?:, [A-H])*)/.exec(row?.note ?? "")?.[1]?.split(", ");
  if (!point || !(point.after > 0) || !paid || !visual?.bands || !visual?.reach) return null;
  const bands = [...visual.bands];
  if (!paid.every((band) => bands.includes(band))) return null;
  const { millions, share, groups } = visual.reach;
  return {
    amount: point.after - point.before,
    bands,
    paid,
    millions,
    share,
    totalMillions: Math.round(millions / share),
    groups,
  };
}

// --- Trading allowance -----------------------------------------------------

/**
 * The tax-free band before and after (the row's first changed year), and
 * the card's example (`visual.example`): its side income and the tax saved.
 */
export function tradingAllowanceView(entry, visual) {
  const row = mainRow(entry);
  const point = row?.points?.find(differs);
  if (!point || !(point.after > point.before) || !visual?.example) return null;
  return { before: point.before, after: point.after, year: point.label, example: visual.example };
}

// --- Bus fare cap --------------------------------------------------------------

/**
 * The single fare cap before and after (the row's one point), and the
 * card's example (`visual.example`): a household's bus fare spending and
 * what it gets in each fiscal year. The saving is the share in the row's
 * note ("10.0% of spending at £3 fares") for the year's capped days
 * (`visual.capped`), grossed up from spending at £2:
 * spending × step / (1 − step), step = share × days. The example's
 * figures must be that, rounded to the pound.
 */
export function busFareCapView(entry, visual) {
  const row = mainRow(entry);
  const point = row?.points?.[0];
  const share = /([0-9.]+)% of spending at £3 fares/.exec(row?.note ?? "")?.[1];
  const example = visual?.example;
  if (!point || !(point.before > point.after) || !share || !example || !visual?.capped) return null;
  const years = Object.keys(example.saved);
  const agrees = years.every((year) => {
    const step = (Number(share) / 100) * visual.capped[year];
    return Math.round((example.spending * step) / (1 - step)) === example.saved[year];
  });
  if (!years.length || !agrees) return null;
  return { before: point.before, after: point.after, window: point.label, share: Number(share) / 100, example };
}

// --- Zero VAT on electricity ------------------------------------------------

/**
 * VAT on electricity month by month, for each part of the UK
 * (`visual.regions`, each with the months it is zero-rated and whether the
 * Budget only expects it there), over `visual.window`; the rates are the
 * row's (5% under current law, 0% with the measure). `visual.law` marks
 * the months already zero-rated in law before the Budget.
 */
export function electricityVatView(entry, visual) {
  const row = mainRow(entry);
  const point = row?.points?.[0];
  if (!point || !differs(point) || !visual?.window || !visual?.regions) return null;
  const count = monthsBetween(visual.window.from, visual.window.to) + 1;
  if (count < 2) return null;
  const months = Array.from({ length: count }, (_, i) => addMonths(visual.window.from, i));
  const within = (month, span) => monthsBetween(span.from, month) >= 0 && monthsBetween(month, span.to) >= 0;
  return {
    before: point.before,
    after: point.after,
    months,
    regions: visual.regions.map((region) => ({
      ...region,
      cells: months.map((month) => ({ month, zero: within(month, region) })),
    })),
    law: visual.law ? { ...visual.law, first: months.indexOf(visual.law.from), last: months.indexOf(visual.law.to) } : null,
    note: row.card_note ?? null,
  };
}

// --- Property income tax ---------------------------------------------------

/**
 * Each property income rate, current law beside the measure, in the first
 * year they differ (the rows, basic, higher and additional).
 */
export function propertyRatesView(entry) {
  const rows = entry?.rows?.filter((row) => row.unit === "percent") ?? [];
  const year = rows[0]?.points?.find(differs)?.label;
  if (!year) return null;
  const rates = rows.map((row) => {
    const point = row.points.find((p) => p.label === year);
    return { label: row.label.replace(/^Property /, ""), before: point?.before, after: point?.after };
  });
  if (rates.some((rate) => typeof rate.before !== "number" || typeof rate.after !== "number")) return null;
  return { year, rates, top: Math.max(...rates.map((rate) => rate.after)) };
}

// --- Pension Tax Allowance ---------------------------------------------------

/**
 * The allowance against total income in one year (`visual.year`): its
 * largest value (the row), the full new State Pension it is paid in full up
 * to and where it is gone (the description), and the explainer's examples
 * (`visual.examples`). Null unless the examples sit on the taper the
 * description gives (£1 for every `taper` of income), to the pound.
 */
export function pensionAllowanceView(entry, visual) {
  const row = mainRow(entry);
  const point = row?.points?.find((p) => p.label === visual?.year);
  if (!point || !(point.after > 0) || !visual?.fullPension || !visual?.goneAt || !visual?.taper) return null;
  const largest = point.after - point.before;
  const at = (income) => Math.max(0, Math.min(largest, largest - (income - visual.fullPension) / visual.taper));
  // Gone where the taper reaches zero, to the pound the description rounds to
  if (Math.abs(visual.fullPension + largest * visual.taper - visual.goneAt) > 1) return null;
  const examples = visual.examples ?? [];
  if (examples.some((example) => Math.abs(at(example.income) - example.allowance) > 1)) return null;
  return { year: visual.year, largest, fullPension: visual.fullPension, goneAt: visual.goneAt, taper: visual.taper, examples, at };
}

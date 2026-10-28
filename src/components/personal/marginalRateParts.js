import { CHART_COLOURS } from "../../utils/chartTheme";

/**
 * The marginal tax rate's parts, in the API's stacking order: what each
 * takes of an extra pound of salary, its colour, its name mid-sentence
 * (`phrase`, when not the label), and for the less familiar ones a
 * one-line note behind an "i" in the legend.
 */
export const RATE_PARTS = [
  { name: "income_tax", label: "Income tax", phrase: "income tax", color: CHART_COLOURS.mtrIncomeTax },
  {
    name: "child_benefit_charge",
    label: "High Income Child Benefit Charge",
    color: CHART_COLOURS.mtrChildBenefit,
    info: "Takes back 1% of Child Benefit for every £200 of income above £60,000, all of it by £80,000.",
  },
  {
    name: "personal_allowance_taper",
    label: "Personal allowance taper",
    phrase: "the personal allowance taper",
    color: CHART_COLOURS.mtrAllowanceTaper,
    info: "The personal allowance falls by £1 for every £2 of income above £100,000, until it is gone at £125,140: each extra pound also makes 50p more taxable.",
  },
  { name: "national_insurance", label: "National Insurance", color: CHART_COLOURS.mtrNationalInsurance },
  { name: "student_loan", label: "Student loan", phrase: "student loan", color: CHART_COLOURS.mtrStudentLoan },
  { name: "universal_credit", label: "Universal Credit taper", color: CHART_COLOURS.mtrUniversalCredit },
  { name: "other_benefits", label: "Other benefits", phrase: "other benefits", color: CHART_COLOURS.mtrOtherBenefits },
  { name: "other", label: "Other", phrase: "other", color: CHART_COLOURS.mtrOther },
];

// A part smaller than this on every step is left off the chart and legend
const NEGLIGIBLE = 0.005;

/** The parts the steps actually use, in stacking order. */
export function partsInUse(steps) {
  return RATE_PARTS.filter((part) => steps.some((step) => Math.abs(step[part.name] ?? 0) >= NEGLIGIBLE));
}

/** The stacked key for a part: its drawn value (negative below zero). */
export const drawnKey = (name) => `${name}Drawn`;

/**
 * The breakdown chart's rows: one per sweep step, at its lower salary, with
 * each part on `side` ("before" or "after" the policies), both totals, and
 * each part as drawn. A part can be negative (a benefit that rises with
 * pay): it is drawn below zero (the chart stacks by sign), so the chart
 * shows what the tooltip gives (Pavel's review, HH8). "Other" is the total
 * less the named parts, never below zero, so the layers reach the total
 * line except where the named parts alone pass it. The last
 * step is repeated at the sweep's end so it is drawn to there.
 */
export function breakdownRows(rates, parts, side = "after") {
  if (!parts) return [];
  const named = RATE_PARTS.filter((part) => part.name !== "other").map((part) => part.name);
  const rows = rates.map((rate, i) => {
    const step = parts[side][i] ?? {};
    const drawn = Object.fromEntries(named.map((name) => [drawnKey(name), step[name] ?? 0]));
    const stacked = Object.values(drawn).reduce((sum, value) => sum + value, 0);
    // Never below zero: a negative remainder (the named parts adding up to
    // more than the step's total, from the sweep's coarse steps) would be a
    // grey sliver under 0% that names nothing, and would stretch the axis
    // (round 3). The total line still gives the rate itself. Rounding dust
    // is no layer
    const other = rate[side] - stacked;
    drawn[drawnKey("other")] = other < 1e-9 ? 0 : other;
    // A negative Other is real (the API's own part), so About this chart says it is not drawn
    const otherUndrawn = other <= -NEGLIGIBLE;
    return { income: rate.income, to: rate.to, ...step, ...drawn, otherUndrawn, before: rate.before, after: rate.after };
  });
  if (rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
  return rows;
}

/** The sweep step whose range holds `income`: the last row starting at or below it (rows by income, ascending). */
export function stepAt(rows, income) {
  if (!rows?.length || income === null || income === undefined) return null;
  let found = null;
  for (const row of rows) {
    if (row.income <= income) found = row;
    else break;
  }
  return found;
}

/**
 * The rate axis for the Current law and With the policies views: 0% to
 * 100%, widened to take in a negative rate or part (below 0%) or one over
 * 100%, as far as −100% and 200%; a rate beyond those is marked at the edge.
 * Ticks every 20 points, every 50 on a wider axis.
 */
export const RATE_AXIS_MIN = -1;
export const RATE_AXIS_MAX = 2;
export function rateAxis(values) {
  const finite = values.filter(Number.isFinite);
  const lo = Math.max(RATE_AXIS_MIN, Math.min(0, ...finite));
  const hi = Math.min(RATE_AXIS_MAX, Math.max(1, ...finite));
  const step = hi - lo > 1.4 ? 0.5 : 0.2;
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = first; t <= last + step / 2; t += step) ticks.push(Math.round(t * 100) / 100);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * Your rate's parts as words, largest first, leaving out any under half a
 * point: "income tax 20%, National Insurance 8%".
 */
export function describeParts(own) {
  if (!own) return "";
  return RATE_PARTS.filter((part) => (own[part.name] ?? 0) >= NEGLIGIBLE)
    .sort((a, b) => own[b.name] - own[a.name])
    .map((part) => `${part.phrase ?? part.label} ${Math.round(own[part.name] * 100)}%`)
    .join(", ");
}

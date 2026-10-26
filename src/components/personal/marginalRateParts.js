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
    label: "Child Benefit clawback",
    color: CHART_COLOURS.mtrChildBenefit,
    info: "The High Income Child Benefit Charge takes back 1% of Child Benefit for every £200 of income above £60,000, all of it by £80,000.",
  },
  {
    name: "personal_allowance_taper",
    label: "Personal allowance taper",
    phrase: "personal allowance taper",
    color: CHART_COLOURS.mtrAllowanceTaper,
    info: "The personal allowance falls by £1 for every £2 of income above £100,000, until it is gone at £125,140: each extra pound also makes 50p more taxable.",
  },
  { name: "national_insurance", label: "National Insurance", color: CHART_COLOURS.mtrNationalInsurance },
  { name: "student_loan", label: "Student loan", phrase: "student loan", color: CHART_COLOURS.mtrStudentLoan },
  { name: "universal_credit", label: "UC taper", color: CHART_COLOURS.mtrUniversalCredit },
  { name: "other_benefits", label: "Other benefits", phrase: "other benefits", color: CHART_COLOURS.mtrOtherBenefits },
  { name: "other", label: "Other", phrase: "other", color: CHART_COLOURS.mtrOther },
];

// A part smaller than this on every step is left off the chart and legend
const NEGLIGIBLE = 0.005;

/** The parts the steps actually use, in stacking order. */
export function partsInUse(steps) {
  return RATE_PARTS.filter((part) => steps.some((step) => Math.abs(step[part.name] ?? 0) >= NEGLIGIBLE));
}

/** The stacked key for a part: its drawn (never negative) value. */
export const drawnKey = (name) => `${name}Drawn`;

/**
 * The breakdown chart's rows: one per sweep step, at its lower salary, with
 * each part on `side` ("before" or "after" the policies), both totals, and each part as drawn. A
 * part can be negative (a benefit that rises with pay); it is drawn at
 * zero and "other" takes up the difference, so the stack still reaches
 * the total. The last step is repeated at the sweep's end so it is drawn
 * to there.
 */
export function breakdownRows(rates, parts, side = "after") {
  if (!parts) return [];
  const named = RATE_PARTS.filter((part) => part.name !== "other").map((part) => part.name);
  const rows = rates.map((rate, i) => {
    const step = parts[side][i] ?? {};
    const drawn = Object.fromEntries(named.map((name) => [drawnKey(name), Math.max(0, step[name] ?? 0)]));
    const stacked = Object.values(drawn).reduce((sum, value) => sum + value, 0);
    drawn[drawnKey("other")] = Math.max(0, rate[side] - stacked);
    return { income: rate.income, to: rate.to, ...step, ...drawn, before: rate.before, after: rate.after };
  });
  if (rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
  return rows;
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

import { CHART_COLOURS } from "../../utils/chartTheme";

/**
 * The marginal tax rate's parts, in the API's stacking order: what each
 * takes of an extra pound of salary, its colour and a one-line note for
 * the legend's "i".
 */
export const RATE_PARTS = [
  {
    name: "income_tax",
    label: "Income tax",
    color: CHART_COLOURS.mtrIncomeTax,
    about: "Income tax on each extra pound, at the rate of the band it falls in.",
  },
  {
    name: "personal_allowance_taper",
    label: "Personal allowance taper",
    color: CHART_COLOURS.mtrAllowanceTaper,
    about:
      "Above the taper threshold the personal allowance falls £1 for every £2 of income, so each extra pound also makes 50p more taxable.",
  },
  {
    name: "national_insurance",
    label: "National Insurance",
    color: CHART_COLOURS.mtrNationalInsurance,
    about: "Employee National Insurance on each extra pound of salary.",
  },
  {
    name: "student_loan",
    label: "Student loan",
    color: CHART_COLOURS.mtrStudentLoan,
    about: "Student loan repayments on earnings above your plan's threshold.",
  },
  {
    name: "child_benefit_charge",
    label: "Child Benefit charge",
    color: CHART_COLOURS.mtrChildBenefit,
    about: "The High Income Child Benefit Charge, which takes back Child Benefit as income rises.",
  },
  {
    name: "universal_credit",
    label: "Universal Credit taper",
    color: CHART_COLOURS.mtrUniversalCredit,
    about: "Universal Credit withdrawn as earnings rise, after tax and National Insurance.",
  },
  {
    name: "other_benefits",
    label: "Other benefits",
    color: CHART_COLOURS.mtrOtherBenefits,
    about: "Other benefits withdrawn as earnings rise, such as Housing Benefit or Pension Credit.",
  },
  {
    name: "other",
    label: "Other",
    color: CHART_COLOURS.mtrOther,
    about: "The rest of the rate, such as pension contributions.",
  },
];

// A part smaller than this on every step is left off the chart and legend
const NEGLIGIBLE = 0.0005;

/** The parts the steps actually use, in stacking order. */
export function partsInUse(steps) {
  return RATE_PARTS.filter((part) =>
    steps.some((step) => Math.abs(step[part.name] ?? 0) >= NEGLIGIBLE),
  );
}

/**
 * The breakdown chart's rows: one per sweep step, at its lower salary, with
 * each part after the policies and both totals; the last step repeated at
 * the sweep's end so it is drawn to there.
 */
export function breakdownRows(rates, parts) {
  if (!parts) return [];
  const rows = rates.map((rate, i) => ({
    income: rate.income,
    to: rate.to,
    ...parts.after[i],
    before: rate.before,
    after: rate.after,
  }));
  if (rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
  return rows;
}

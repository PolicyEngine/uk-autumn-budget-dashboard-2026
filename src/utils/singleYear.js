/**
 * What the Single-year effect shows, worked out from the API's answer
 * (normaliseHouseholdImpact): the per-policy rows, the programme table,
 * the "largest changes" sentence and the marginal tax rates. Pure
 * functions, so the page and its tests read the same numbers.
 */
import { consistentRound } from "./householdImpactApi";
import { getPolicyColor } from "./policyConfig";

const MINUS = "−";

/** "£1,234", whole pounds, a true minus. */
export function money(value) {
  const rounded = Math.round(value);
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return rounded < 0 ? `${MINUS}${text}` : text;
}

/** "+£40", "−£430", "£0": a change, signed. */
export function signedMoney(value) {
  const rounded = Math.round(value);
  if (rounded === 0) return "£0";
  return rounded > 0 ? `+${money(rounded)}` : money(rounded);
}

/** "−1.4%" of `base`, one decimal; null without a base. */
export function signedPercent(value, base) {
  if (!base) return null;
  const pct = Math.round((value / Math.abs(base)) * 1000) / 10;
  if (pct === 0) return "0.0%";
  return `${pct > 0 ? "+" : MINUS}${Math.abs(pct).toFixed(1)}%`;
}

/** Programme names, in sentence case (as the dashboard writes them). */
export const PROGRAMME_LABELS = {
  income_tax: "Income tax",
  earned_income_tax: "On earnings",
  savings_income_tax: "On savings",
  dividend_income_tax: "On dividends",
  property_income_tax: "On property income",
  national_insurance: "National Insurance",
  student_loan_repayment: "Student loan repayment",
  council_tax: "Council tax",
  fuel_duty: "Fuel duty",
  universal_credit: "Universal Credit",
  uc_standard_allowance: "Standard allowance",
  uc_child_element: "Child element",
  uc_housing_costs_element: "Housing element",
  uc_childcare_element: "Childcare element",
  child_benefit: "Child Benefit",
  tax_free_childcare: "Tax-Free Childcare",
  housing_benefit: "Housing Benefit",
  pension_credit: "Pension Credit",
  state_pension: "State Pension",
  employment_income: "Employment income",
  dividend_income: "Dividends",
  savings_interest_income: "Savings interest",
  property_income: "Property income",
};

/** How "the largest changes are to …" names a programme mid-sentence. */
const IN_SENTENCE = {
  income_tax: "income tax",
  student_loan_repayment: "student loan repayments",
  council_tax: "council tax",
  fuel_duty: "fuel duty",
  employment_income: "employment income",
  dividend_income: "dividends",
  savings_interest_income: "savings interest",
  property_income: "property income",
};

export const GROUPS = [
  { id: "tax", label: "Taxes" },
  { id: "benefit", label: "Benefits" },
  { id: "income", label: "Earnings and other income" },
];

const programmeLabel = (row) =>
  row.label ?? PROGRAMME_LABELS[row.id] ?? row.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The table's rows, grouped: taxes as negative amounts, a row only where
 * before or after is not £0, the change as the effect on the household.
 */
export function programmeGroups(programmes) {
  const toRow = (row, sign) => {
    const before = sign * row.before;
    const after = sign * row.after;
    return {
      id: row.id,
      label: programmeLabel(row),
      before,
      after,
      change: after - before,
      children: (row.children ?? [])
        .filter((child) => Math.round(child.before) !== 0 || Math.round(child.after) !== 0)
        .map((child) => toRow(child, sign)),
    };
  };
  return GROUPS.map((group) => ({
    ...group,
    rows: (programmes ?? [])
      .filter((row) => (row.group ?? "benefit") === group.id)
      .filter((row) => Math.round(row.before) !== 0 || Math.round(row.after) !== 0)
      .map((row) => toRow(row, group.id === "tax" ? -1 : 1)),
  })).filter((group) => group.rows.length > 0);
}

/**
 * One sentence naming the two largest programme changes, without figures
 * (the figures are in the table).
 */
export function largestChangesSentence(groups) {
  const changed = groups
    .flatMap((group) => group.rows)
    .filter((row) => Math.round(row.change) !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const name = (row) => IN_SENTENCE[row.id] ?? row.label;
  if (changed.length === 0) return "No tax or benefit in the table changes for your household.";
  if (changed.length === 1) return `The only change is to ${name(changed[0])}.`;
  return `The largest changes are to ${name(changed[0])} and ${name(changed[1])}.`;
}

/**
 * The per-policy rows: each measure that changes the household, sorted by
 * size, in whole pounds that add up to the headline change (largest
 * remainder). Measures worth £0 to the household are listed by name. If
 * the API's rows do not add up to the change (an interaction left over),
 * that is a row of its own, so the bars still add up.
 *
 * @param {Array<{id: string, change: number}>} byPolicy
 * @param {number} total - The headline change
 * @param {Array<{id: string, name: string}>} policies - Names, by id
 */
export function policyRows(byPolicy, total, policies) {
  const nameOf = (id) => policies.find((policy) => policy.id === id)?.name ?? id.replace(/_/g, " ");
  const sum = byPolicy.reduce((acc, row) => acc + row.change, 0);
  const rows = byPolicy.map((row) => ({
    id: row.id,
    name: nameOf(row.id),
    color: getPolicyColor(row.id),
    change: row.change,
  }));
  if (Math.abs(sum - total) >= 1) {
    rows.push({
      id: "interaction",
      name: "Interaction between policies",
      color: "#9CA3AF",
      change: total - sum,
    });
  }
  const rounded = consistentRound(
    rows.map((row) => row.change),
    total,
  );
  rows.forEach((row, index) => {
    row.rounded = rounded[index];
  });
  return {
    rows: rows
      .filter((row) => row.rounded !== 0)
      .sort((a, b) => Math.abs(b.rounded) - Math.abs(a.rounded)),
    noEffect: rows.filter((row) => row.rounded === 0 && row.id !== "interaction").map((row) => row.name),
  };
}

/**
 * The sweep's points: salary, net income before and after, and the change.
 */
export function sweepPoints(sweep) {
  if (!sweep) return [];
  return sweep.income.map((income, index) => ({
    income,
    before: sweep.before[index],
    after: sweep.after[index],
    change: sweep.after[index] - sweep.before[index],
  }));
}

/**
 * Marginal tax rates between sweep points: 1 − Δnet / Δearnings, before and
 * after, on each step from one point to the next (plotted at its start).
 */
export function marginalRates(sweep) {
  const points = sweepPoints(sweep);
  const rates = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const step = points[i + 1].income - points[i].income;
    if (step <= 0) continue;
    rates.push({
      income: points[i].income,
      to: points[i + 1].income,
      before: 1 - (points[i + 1].before - points[i].before) / step,
      after: 1 - (points[i + 1].after - points[i].after) / step,
    });
  }
  return rates;
}

/** The marginal rate on the step that holds `income`. */
export function rateAt(rates, income) {
  if (!rates.length) return null;
  return rates.find((rate) => income >= rate.income && income < rate.to) ?? rates[rates.length - 1];
}

/**
 * Steps where net income after the policies falls as salary rises by more
 * than `threshold` pounds: [{from, to, drop}].
 */
export function netIncomeDrops(points, threshold = 100) {
  const drops = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const drop = points[i].after - points[i + 1].after;
    if (drop > threshold) drops.push({ from: points[i].income, to: points[i + 1].income, drop });
  }
  return drops;
}

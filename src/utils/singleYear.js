/**
 * What Personal impact shows, worked out from the API's answer
 * (normaliseHouseholdImpact): the per-policy rows, the programme table,
 * the "largest changes" sentence and the marginal tax rates. Pure
 * functions, so the page and its tests read the same numbers.
 */
import { consistentRound } from "./householdImpactApi";
import { getPolicyColor } from "./policyConfig";
import { CHART_COLOURS } from "./chartTheme";

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
  child_benefit_charge: "High Income Child Benefit Charge",
  national_insurance: "National Insurance",
  student_loan_repayments: "Student loan repayment",
  council_tax: "Council tax",
  fuel_duty: "Fuel duty",
  tv_licence: "TV licence",
  pension_contributions: "Pension contributions from pay",
  other_taxes: "Other taxes",
  universal_credit: "Universal Credit",
  uc_standard_allowance: "Standard allowance",
  uc_child_element: "Child element",
  uc_housing_costs_element: "Housing element",
  uc_childcare_element: "Childcare element",
  benefit_cap: "Benefit cap",
  council_tax_reduction: "Council Tax Reduction",
  child_benefit: "Child Benefit",
  tax_free_childcare: "Tax-Free Childcare",
  housing_benefit: "Housing Benefit",
  pension_credit: "Pension Credit",
  state_pension: "State Pension",
  winter_fuel_payment: "Winter Fuel Payment",
  scottish_child_payment: "Scottish Child Payment",
  free_childcare: "Free childcare hours",
  universal_childcare_entitlement: "Universal hours (3- and 4-year-olds)",
  extended_childcare_entitlement: "Working parents' hours",
  targeted_childcare_entitlement: "Disadvantaged 2-year-olds' hours",
  other_benefits: "Other benefits",
  employment_income: "Employment income",
  salary_sacrifice_haircut: "Salary sacrifice cap: broad-base pay cut",
  dividend_income: "Dividends",
  savings_interest_income: "Savings interest",
  property_income: "Property income",
  private_pension_income: "Private pension",
  other_income: "Other income",
};

/** How "the largest changes are to …" names a programme mid-sentence. */
const IN_SENTENCE = {
  income_tax: "income tax",
  student_loan_repayments: "student loan repayments",
  council_tax: "council tax",
  fuel_duty: "fuel duty",
  tv_licence: "the TV licence",
  pension_contributions: "pension contributions",
  free_childcare: "free childcare hours",
  employment_income: "employment income",
  dividend_income: "dividends",
  savings_interest_income: "savings interest",
  property_income: "property income",
  private_pension_income: "private pension",
  benefit_cap: "the benefit cap",
};

// The breakdown's top rows, in Spring Statement's order: market income,
// taxes, benefits, pension contributions. Each opens to its programmes.
export const GROUPS = [
  { id: "income", label: "Market income", color: "#4A7BA7" },
  { id: "tax", label: "Taxes", color: CHART_COLOURS.noChange },
  { id: "benefit", label: "Benefits", color: CHART_COLOURS.gain },
  { id: "pension", label: "Pension contributions", color: "#B8875A" },
];

// Rows the API files under taxes that the breakdown shows as their own
// top row, as Spring Statement does
const OWN_GROUP = { pension_contributions: "pension" };
const NEGATIVE_GROUPS = new Set(["tax", "pension"]);
const groupOf = (row) => OWN_GROUP[row.id] ?? row.group ?? "benefit";

// The dashboard's sentence-case names first; the API's labels ("Income
// Tax") for a row this list does not know
const programmeLabel = (row) =>
  PROGRAMME_LABELS[row.id] ?? row.label ?? row.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

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
      note: row.note ?? null,
      before,
      after,
      change: typeof row.change === "number" ? sign * row.change : after - before,
      children: (row.children ?? [])
        .filter((child) => Math.round(child.before) !== 0 || Math.round(child.after) !== 0)
        .map((child) => toRow(child, sign)),
    };
  };
  return GROUPS.map((group) => ({
    ...group,
    rows: (programmes ?? [])
      .filter((row) => groupOf(row) === group.id)
      .filter((row) => Math.round(row.before) !== 0 || Math.round(row.after) !== 0)
      .map((row) => toRow(row, NEGATIVE_GROUPS.has(group.id) ? -1 : 1)),
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

// Notes about one part of a row, shown only when that part is: income
// tax's is about the High Income Child Benefit Charge, employment income's
// about the salary sacrifice cap's pay cut
const NOTE_PART = {
  income_tax: "child_benefit_charge",
  employment_income: "salary_sacrifice_haircut",
};

/** The notes of the rows the table shows, once each: [{id, label, note}]. */
export function programmeNotes(groups) {
  return groups
    .flatMap((group) => group.rows)
    .filter((row) => row.note)
    .filter((row) => !NOTE_PART[row.id] || row.children.some((child) => child.id === NOTE_PART[row.id]))
    .map((row) => ({ id: row.id, label: row.label, note: row.note }));
}

/** The interaction row shows only from this size (£), so bars add up. */
export const INTERACTION_THRESHOLD = 1;

/**
 * The per-policy rows (the API's single-measure method): each measure's own
 * change, that measure alone at its Budget setting with the other selected
 * measures at pre-Budget law. Where the combined change differs from the
 * sum of those by £1 or more, the difference is a row of its own,
 * "Interaction between policies", so the bars add up to the change. In
 * whole pounds that add up to the headline tile (largest remainder), sorted
 * by size. Measures that do not move the household at all are listed by
 * name, and measures worth under £1 separately.
 *
 * @param {{measures: Array<{id, name, change, status}>, residual: number}} byPolicy
 * @param {number} total - The headline change, as the tile shows it
 * @param {Array<{id: string, name: string}>} policies - The dashboard's names, by id
 */
export function policyRows(byPolicy, total, policies) {
  const nameOf = (row) =>
    policies.find((policy) => policy.id === row.id)?.name ?? row.name ?? row.id.replace(/_/g, " ");
  const affected = byPolicy.measures.filter((row) => row.status !== "not_affected");
  const rows = affected.map((row) => ({
    id: row.id,
    name: nameOf(row),
    color: getPolicyColor(row.id),
    change: row.change,
  }));
  if (Math.abs(byPolicy.residual) >= INTERACTION_THRESHOLD) {
    rows.push({
      id: "interaction",
      name: "Interaction between policies",
      color: CHART_COLOURS.noChange,
      change: byPolicy.residual,
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
    // Every row with its whole pounds, £0 ones too (for the table's rows)
    all: rows,
    rows: rows
      .filter((row) => row.rounded !== 0)
      .sort((a, b) => Math.abs(b.rounded) - Math.abs(a.rounded)),
    noEffect: byPolicy.measures.filter((row) => row.status === "not_affected").map(nameOf),
    underAPound: rows.filter((row) => row.rounded === 0 && row.id !== "interaction").map((row) => row.name),
  };
}

// A table row's change is a bar's when they are the same to within the
// API's rounding: it rounds each net income and each programme to the
// penny, so the same amount can differ by a penny or two between them
const SAME_CHANGE = 0.025;

/**
 * Whole pounds for the change column that add up to `total` (largest
 * remainder, as the bars), with each row whose change is one policy bar's
 * change (the same measure-driven amount, to within the API's
 * penny rounding) shown as that
 * bar's whole pounds, so the table and the bars never disagree on it. Each
 * bar pins one row at most. Falls back to plain consistent rounding if the
 * pinned rows leave the rest unable to reach the total.
 *
 * @param {number[]} values - The rows' changes
 * @param {number} total - The headline change, as the tile shows it
 * @param {Array<{change: number, rounded: number}>} [bars] - policyRows(...).all
 * @returns {number[]}
 */
export function pinnedRound(values, total, bars = []) {
  const pins = values.map(() => null);
  const used = new Set();
  values.forEach((value, index) => {
    if (Math.abs(value) < SAME_CHANGE) return;
    const bar = bars.findIndex(
      (row, barIndex) =>
        !used.has(barIndex) && row.id !== "interaction" && Math.abs(row.change - value) < SAME_CHANGE,
    );
    if (bar >= 0) {
      used.add(bar);
      pins[index] = bars[bar].rounded;
    }
  });
  const free = values.map((_, index) => index).filter((index) => pins[index] === null);
  const pinnedSum = pins.reduce((sum, pin) => sum + (pin ?? 0), 0);
  const rest = consistentRound(
    free.map((index) => values[index]),
    Math.round(total) - pinnedSum,
  );
  const out = pins.slice();
  free.forEach((index, i) => {
    out[index] = rest[i];
  });
  const sum = out.reduce((acc, value) => acc + value, 0);
  return sum === Math.round(total) ? out : consistentRound(values, total);
}

/**
 * The whole pounds the programme table shows, as `shown: {before, after,
 * change}` on each row and part. The before column adds up to the before
 * tile and the change column to the change tile (consistentRound; the
 * change pinned to the policy bars by `pinnedRound`), and each row's after
 * is its before plus its change, so the after column adds up to the after
 * tile and no row's figures contradict each other. A row's parts add up to
 * the row where their amounts do (income tax's), else round on their own.
 *
 * @param {ReturnType<typeof programmeGroups>} groups
 * @param {{before: number, after: number, change: number}} totals - headlineTotals
 * @param {Array<{change: number, rounded: number}>} [bars] - policyRows(...).all
 */
export function roundProgrammeGroups(groups, totals, bars = []) {
  const shown = (before, change) => ({ before, change, after: before + change });
  const parts = (children, parent) => {
    if (children.length === 0) return [];
    const fits = (side) =>
      Math.abs(children.reduce((sum, child) => sum + child[side], 0) - parent.raw[side]) < 1;
    const before = fits("before")
      ? consistentRound(
          children.map((child) => child.before),
          parent.shown.before,
        )
      : children.map((child) => Math.round(child.before));
    const change = fits("change")
      ? consistentRound(
          children.map((child) => child.change),
          parent.shown.change,
        )
      : children.map((child) => Math.round(child.change));
    return children.map((child, index) => ({ ...child, shown: shown(before[index], change[index]) }));
  };
  const rows = groups.flatMap((group) => group.rows);
  const before = consistentRound(
    rows.map((row) => row.before),
    totals.before,
  );
  const change = pinnedRound(
    rows.map((row) => row.change),
    totals.change,
    bars,
  );
  const byId = new Map(rows.map((row, index) => [row.id, shown(before[index], change[index])]));
  return groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      const rowShown = byId.get(row.id);
      return {
        ...row,
        shown: rowShown,
        children: parts(row.children, { raw: row, shown: rowShown }),
      };
    }),
  }));
}

/**
 * Each group's whole pounds: the sum of its rows' shown figures, so the
 * top rows add up to net income.
 *
 * @param {ReturnType<typeof roundProgrammeGroups>} groups
 */
export function groupTotals(groups) {
  return groups.map((group) => {
    const sum = (side) => group.rows.reduce((acc, row) => acc + row.shown[side], 0);
    return { ...group, shown: { before: sum("before"), after: sum("after"), change: sum("change") } };
  });
}

/**
 * The headline sentence's verb and amount, as Spring Statement words it:
 * "would raise … by £103", "would lower … by £570", or "would not change".
 *
 * @param {number} change - The whole-pound change
 */
export function headlineVerb(change) {
  if (change > 0) return "raise";
  if (change < 0) return "lower";
  return "not change";
}

/** The sweep's points: salary, net income before and after, and the change. */
export function sweepPoints(sweep) {
  return sweep?.points ?? [];
}

/**
 * Marginal tax rates between sweep points, as the API works them out:
 * 1 − Δnet / Δearnings, before and after, on each step from one point to
 * the next (plotted at its start).
 */
export function marginalRates(sweep) {
  return sweep?.rates ?? [];
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

/** "Inner South East London" from the API's BRMA name. */
export function areaName(brma) {
  if (!brma) return null;
  const small = new Set(["AND", "OF", "THE", "UPON", "ON"]);
  return String(brma)
    .split("_")
    .map((word, index) =>
      index > 0 && small.has(word) ? word.toLowerCase() : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

/**
 * How the single-year calculation works, in one place: the Methodology
 * tab's single-year card and the page's "How this is calculated" expander
 * both show these, as [term, text].
 */
export const SINGLE_YEAR_METHOD = [
  [
    "Engine and measures",
    "The same engine (policyengine.py and policyengine-uk) and the same measures as the national figures, applied to one household's answers.",
  ],
  [
    "One year",
    "The year chosen in the bar above. Net income is before housing costs (rent is not taken off; no selected policy changes it), under pre-Budget law and with the selected policies.",
  ],
  [
    "Salary",
    "Entered for 2026 and grown to the chosen year with the OBR's average earnings forecast, the index policyengine-uk uprates earnings with.",
  ],
  [
    "Change by policy",
    "Each policy's bar is that policy on its own: switched to its Budget setting, with every other selected policy held at pre-Budget law, against the same baseline. Policies can interact, so their own effects need not add up to the combined change; a difference of £1 or more is shown as “Interaction between policies”, so the bars add up to the change in the tiles.",
  ],
  [
    "Marginal tax rate",
    "The share of an extra pound of salary lost to taxes and withdrawn benefits, between neighbouring points of the earnings sweep, with everything else held as entered.",
  ],
  [
    "Not modelled for one household",
    "Six of the candidate measures change a formula in code, not just parameters, which policyengine.py's household calculation cannot apply, so they are in the national figures only: the fuel duty deferral (the VAT on the lower pump price), the State Pension income tax protection, the Warm Home Discount top-up, zero VAT on domestic electricity, the road fuel VAT cut and the employer NI relief for under-25s. Two would be £0 for a household anyway: the form takes no electricity spending, and the employer NI relief changes what employers pay, with wages held fixed.",
  ],
  [
    "Who counts as a child",
    "Everyone under 16, and a 16- to 19-year-old in full-time non-advanced education (school or college) begun before 19, as you answer for each. Child Benefit counts such a young person until 20; Universal Credit stops at the 1 September after their 19th birthday, so a 19-year-old counts for Child Benefit but not Universal Credit.",
  ],
  [
    "Council Tax",
    "Estimated from your band and your region's average Band D for 2026-27 (MHCLG for England, tax-base weighted by region; the Welsh and Scottish governments), grown to the chosen year with policyengine-uk's OBR Council Tax forecast, and taken off net income. Northern Ireland has domestic rates, which are not modelled. No selected policy changes it.",
  ],
];

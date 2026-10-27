/**
 * What Household impact shows, worked out from the API's answer
 * (normaliseHouseholdImpact): the per-policy rows, the programme table,
 * the "largest changes" sentence and the marginal tax rates. Pure
 * functions, so the page and its tests read the same numbers.
 */
import {
  CHANGE_BY_POLICY_NOTE,
  COUNCIL_TAX_NOTE,
  EVERY_POLICY_NOTE,
  MARGINAL_RATE_NOTE,
  WHO_IS_A_CHILD_NOTE,
} from "../components/personal/singleYearMethodNotes";
import { consistentRound } from "./householdImpactApi";
import { CHART_COLOURS } from "./chartTheme";
import { shortNameOf } from "./policyDetails";

export const MINUS = "−";

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
  council_tax: "Council Tax",
  fuel_duty: "Fuel duty",
  vat_change: "VAT change",
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
  warm_home_discount_top_up: "Warm Home Discount top-up",
  scottish_child_payment: "Scottish Child Payment",
  free_childcare: "Free childcare hours",
  universal_childcare_entitlement: "Universal hours (3- and 4-year-olds)",
  extended_childcare_entitlement: "Working parents' hours",
  targeted_childcare_entitlement: "Disadvantaged 2-year-olds' hours",
  other_benefits: "Other benefits",
  employment_income: "Employment income",
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
  council_tax: "Council Tax",
  fuel_duty: "fuel duty",
  vat_change: "VAT",
  warm_home_discount_top_up: "the Warm Home Discount top-up",
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
  { id: "income", label: "Market income", color: CHART_COLOURS.marketIncome },
  { id: "tax", label: "Taxes", color: CHART_COLOURS.noChange },
  { id: "benefit", label: "Benefits", color: CHART_COLOURS.gain },
  { id: "pension", label: "Pension contributions", color: CHART_COLOURS.pensionContributions },
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

// Rows that are only the change the measures make, not an amount the
// household pays: VAT on the spending entered (the form asks about no other
// spending, so VAT itself is unknown). Before is a dash; after is the
// change, signed as the other taxes (a cut is a positive amount).
export const CHANGE_ONLY = new Set(["vat_change"]);

// This page's note on a row, in place of the API's
const PROGRAMME_NOTES = {
  vat_change:
    "Only the change the measures make to VAT on the electricity, petrol and diesel spending entered, not the VAT you pay, so a cut shows as a positive amount.",
};

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
      note: PROGRAMME_NOTES[row.id] ?? row.note ?? null,
      changeOnly: CHANGE_ONLY.has(row.id),
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
// about its pay cut row (labelled by the household API)
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
 * measures at current law. Where the combined change differs from the
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
  // A short name for tight labels (policyDetails.js's, while it describes
  // the published measure), else the name
  const labelOf = (row) => {
    const measure = policies.find((policy) => policy.id === row.id);
    return measure ? shortNameOf(measure) : nameOf(row);
  };
  const affected = byPolicy.measures.filter((row) => row.status !== "not_affected");
  const rows = affected.map((row) => ({
    id: row.id,
    name: nameOf(row),
    label: labelOf(row),
    color: policies.find((policy) => policy.id === row.id)?.color ?? CHART_COLOURS.noChange,
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
    // An employer cost has its own note, not "no effect"
    noEffect: byPolicy.measures
      .filter((row) => row.status === "not_affected" && row.noteKind !== "employer_cost")
      .map(nameOf),
    // Every measure that leaves the household's net income where it was,
    // with its colour and, for an employer cost, the API's note on why. No
    // reason is kept here by measure id: that would be a measure list of
    // the page's own
    noEffectItems: byPolicy.measures
      .filter((row) => row.status === "not_affected")
      .map((row) => ({
        id: row.id,
        name: nameOf(row),
        label: labelOf(row),
        color: policies.find((policy) => policy.id === row.id)?.color ?? CHART_COLOURS.noChange,
        reason: row.noteKind === "employer_cost" ? row.note : null,
      })),
    // Notes on a measure's figure: an employer cost always, "if received"
    // where the household gets the amount
    notes: byPolicy.measures
      .filter(
        (row) =>
          row.note && (row.noteKind === "employer_cost" || (row.noteKind === "if_received" && row.change !== 0)),
      )
      .map((row) => ({ id: row.id, name: nameOf(row), kind: row.noteKind, text: row.note })),
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

// Rows the headline card also states, rounded on their own there ("Based
// on: Council Tax £2,629"): the table keeps that whole-pound figure
// rather than nudging it by £1 to make its column add up.
export const STATED_ELSEWHERE = new Set(["council_tax"]);

/**
 * The before column's whole pounds (consistentRound to `total`), with each
 * row in STATED_ELSEWHERE at its own rounding and the others adding up to
 * the rest; plain consistent rounding if they then cannot.
 */
export function pinnedBefore(rows, total) {
  const values = rows.map((row) => row.before);
  // Rounded as money() rounds the headline's positive amount: half away from
  // zero, so a negated row at an exact 50p (−£2,628.50) is −£2,629, not −£2,628
  const pinned = rows.map((row) =>
    STATED_ELSEWHERE.has(row.id) ? Math.sign(row.before) * Math.round(Math.abs(row.before)) || 0 : null,
  );
  const free = values.map((_, index) => index).filter((index) => pinned[index] === null);
  if (free.length === values.length || free.length === 0) return consistentRound(values, total);
  const pinnedSum = pinned.reduce((sum, pin) => sum + (pin ?? 0), 0);
  const freeValues = free.map((index) => values[index]);
  const rest = Math.round(total) - pinnedSum;
  // Only when the free rows already sum to the rest within £1, as
  // consistentRound assumes
  if (Math.abs(freeValues.reduce((sum, value) => sum + value, 0) - rest) > 1) {
    return consistentRound(values, total);
  }
  const rounded = consistentRound(freeValues, rest);
  const out = pinned.slice();
  free.forEach((index, i) => {
    out[index] = rounded[i];
  });
  return out;
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
  const before = pinnedBefore(rows, totals.before);
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
 * The marginal rate as money: "Of your next £1,000 of earnings, you keep
 * £324." from the rates over the next £200 (the API's own step), before
 * and after, said once when they round to the same pounds. A rate over
 * 200% is a cliff (net income falls by more than the £200 earned), which
 * a £1,000 multiple would overstate, so the sentence is then about the
 * next £200 itself. A keep below zero is a loss: "you would lose £X".
 * Null without both rates.
 */
export function keepSentence(before, after) {
  const clause = keepClause(before, after);
  return clause && `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * keepSentence's words without the capital or full stop, to follow the
 * marginal rate in one sentence: "of your next £1,000 of earnings, you
 * keep £720". Null without both rates.
 */
export function keepClause(before, after, { first = false } = {}) {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  // With no earnings yet, the API's rate is over the first £200 only: say
  // that, not a wider sum it may not hold for
  const unit = first || before > 2 || after > 2 ? 200 : 1000;
  const kept = (rate) => Math.round(unit * (1 - rate));
  const say = (amount) =>
    amount < 0 ? `would lose ${money(-amount)}` : `keep ${money(amount)}`;
  const lead = `of your ${first ? "first" : "next"} ${money(unit)} of earnings, you`;
  const [was, now] = [kept(before), kept(after)];
  if (was === now) return `${lead} ${say(was)}`;
  return `${lead} ${say(was)} before and ${say(now)} after`;
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
 * view's Household impact section shows these, as [term, text]; the
 * Household impact cards link there.
 */
export const SINGLE_YEAR_METHOD = [
  [
    "Engine and policies",
    "The same engine (policyengine.py and policyengine-uk) and the same policies as the national figures, applied to one household's answers.",
  ],
  [
    "One year",
    "The year chosen in the bar above. Net income is before housing costs (rent is not taken off; no selected policy changes it), under current law and with the selected policies.",
  ],
  [
    "Salary",
    "Entered for 2026 and grown to the chosen year with the OBR's average earnings forecast, the index policyengine-uk uprates earnings with.",
  ],
  [
    "Change by policy",
    CHANGE_BY_POLICY_NOTE,
  ],
  [
    "Marginal tax rate",
    MARGINAL_RATE_NOTE,
  ],
  [
    "Every policy applied",
    EVERY_POLICY_NOTE,
  ],
  [
    "Who counts as a child",
    WHO_IS_A_CHILD_NOTE,
  ],
  [
    "Council Tax",
    COUNCIL_TAX_NOTE,
  ],
];

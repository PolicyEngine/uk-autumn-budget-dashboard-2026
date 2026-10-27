/**
 * The household table's policy tabs (ProgrammeTable): for each selected
 * measure that changes this household, its own Before / After / Change
 * table, worked out from what the page already has. Pure, so the page and
 * its tests read the same figures.
 *
 * Each tab has up to three parts:
 * - What changes: the measure's policy parameters for the year, current
 *   law beside the measure (public/data/policy_parameters.json, the same
 *   file and the same guard as the Policies cards: none for a measure
 *   changed since the file was built);
 * - For your household: the household's own inputs the measure works on
 *   (spending, income), simple steps where the page can check them
 *   against the API's answer, and the table rows the measure alone moves;
 * - Effect on your net income: the measure's by_policy change, in the
 *   whole pounds the "Change by policy" bars show (policyRows), so the
 *   tabs and the bars never disagree.
 *
 * Steps are written per kind of parameter (a fuel rate, a student loan
 * threshold, an income tax allowance), never per measure id, so a measure
 * added on Budget day still gets its parameters and its effect.
 */
import { parameterTableFor } from "./policyParameters";
import { policyDetailsFor, shortNameOf } from "./policyDetails";
import { measureCategoryOf } from "./measureCategory";
import { consistentRound } from "./householdImpactApi";

// A table row's change is a measure's when they agree to within the API's
// penny rounding (singleYear.js pinnedRound's tolerance)
const SAME_CHANGE = 0.025;

// The student loan repayment rate on income above the threshold (Plans 1,
// 2, 4 and 5). Only ever shown when the page's 9% of the income above the
// threshold matches the API's repayment, before and after, to within £1.
export const STUDENT_LOAN_RATE = 0.09;
const MATCH_POUNDS = 1;

// The kinds of parameter a step is written for, by the parameter's unit and
// name in policy_parameters.json (never by measure id)
const KIND_TESTS = [
  ["studentLoan", (row) => /plan\s*\d\b.*repayment threshold/i.test(row.label)],
  ["employerNi", (row) => /employer national insurance/i.test(row.label)],
  ["fuelDuty", (row) => row.unit === "pence_per_litre" || /\bfuel duty\b/i.test(row.label)],
  ["fuelVat", (row) => /\bVAT\b/.test(row.label) && /(petrol|diesel|road fuel)/i.test(row.label)],
  ["electricityVat", (row) => /electricity/i.test(row.label)],
  ["pensionAgeAllowance", (row) => /state pension age/i.test(row.label)],
  ["unearned", (row) => /^(dividend|savings|property)\b.*\brate\b/i.test(row.label)],
  ["incomeTaxThreshold", (row) => row.unit === "gbp" && /(personal allowance|rate threshold|rate band)/i.test(row.label)],
];
export const parameterKind = (row) => KIND_TESTS.find(([, test]) => test(row))?.[0] ?? null;

// Kinds that work only on spending entered: they move only these rows
const SPENDING_KINDS = new Set(["fuelDuty", "fuelVat", "electricityVat"]);
const SPENDING_ROWS = new Set(["fuel_duty", "vat_change"]);

const studentLoanPlan = (row) => {
  const match = /plan\s*(\d)\b/i.exec(row.label);
  return match ? `PLAN_${match[1]}` : null;
};

// A measure without parameters in the file (none, or changed since it was
// built): its kind from its name or category, for spending it works on
const kindsFromName = (measure) => {
  const named = [measure?.name, measure?.label, measureCategoryOf(measure).label].filter(Boolean).join(" ");
  if (/winter fuel/i.test(named)) return [];
  if (/electricity/i.test(named)) return ["electricityVat"];
  if (/fuel duty/i.test(named)) return ["fuelDuty"];
  if (/\b(fuel|petrol|diesel)\b/i.test(named)) return ["fuelVat"];
  return [];
};

/**
 * The measure's parameter rows for `year`: those with a value for that
 * fiscal year (a rate in force for part of a year is the file's "averaged
 * over the year" row). Empty without the file's entry.
 */
export function parameterRowsFor(parameters, measure, year) {
  const entry = parameterTableFor(parameters, measure);
  if (!entry) return [];
  return entry.rows
    .map((row) => {
      const point = (row.points ?? []).find((p) => p.key === String(year));
      if (!point) return null;
      return { kind: "parameter", id: row.label, label: row.label, unit: row.unit, before: point.before, after: point.after };
    })
    .filter(Boolean);
}

/** A parameter's Change cell: signed for an amount, "Lower"/"Higher" for a rate. */
export function parameterChange(row) {
  const diff = (row.after ?? 0) - (row.before ?? 0);
  if (Math.abs(diff) < 1e-9) return null;
  if (row.unit === "percent") return diff > 0 ? "Higher" : "Lower";
  const sign = diff > 0 ? "+" : "−";
  if (row.unit === "pence_per_litre") {
    return `${sign}${Math.abs(diff).toLocaleString("en-GB", { maximumFractionDigits: 2 })}p`;
  }
  return `${sign}£${Math.round(Math.abs(diff)).toLocaleString("en-GB")}`;
}

// Everything the Summary shows, its programmes and their parts, by id
const flatRows = (groups) =>
  (groups ?? []).flatMap((group) =>
    (group.rows ?? []).flatMap((row) => [
      { ...row, group: group.id, parent: null },
      ...(row.children ?? []).map((child) => ({ ...child, group: group.id, parent: row.id })),
    ]),
  );
const moves = (row) => Math.abs(row.change) >= SAME_CHANGE;

const inputRow = (id, label, value) => ({ kind: "input", id, label, before: value, after: value });
const stepRow = (id, label, before, after) => ({ kind: "step", id, label, before, after });
// A part of the effect on net income: a Summary row (its whole pounds), or
// a figure worked out here (`before`/`after` null when it has none)
const fromSummary = (row, label = row.label) => ({
  kind: "part",
  id: row.id,
  label,
  changeOnly: row.changeOnly,
  before: row.shown?.before ?? row.before,
  raw: row.change,
});
const worked = (id, label, before, after, raw) => ({ kind: "part", id, label, before, after, raw });

const rateWords = (value) => `${Number((value * 100).toFixed(2))}%`;

// The VAT inside a VAT-inclusive amount at `rate`
const vatIn = (amount, rate) => (amount * rate) / (1 + rate);

/**
 * One tab's "For your household": inputs entered, steps worked out from
 * the API's answer and the published parameters, and the parts of the
 * effect. Parts are kept only when they add up to the measure's effect
 * (within £1 before rounding); a step the page cannot check is left out.
 */
function householdSteps({ params, kinds, household, salaryUsed, rows: allRows, effectRaw, othersMoving }) {
  const h = household ?? {};
  const rows = allRows.filter((item) => !item.isGroup);
  const income = allRows.find((item) => item.isGroup && item.id === "income");
  const steps = [];
  let parts = null;
  const has = (kind) => kinds.includes(kind);
  const param = (kind, test = () => true) => params.find((row) => parameterKind(row) === kind && test(row));
  const row = (id) => rows.find((item) => item.id === id);
  const fuelSpending = (Number(h.petrol_spending) || 0) + (Number(h.diesel_spending) || 0);
  const electricity = Number(h.electricity_spending) || 0;
  // A spending row is this measure's alone when no other moving measure
  // works on it
  const alone = (rowId) =>
    !othersMoving.some(
      (other) =>
        other.kinds.length === 0 ||
        other.kinds.some((kind) => (rowId === "fuel_duty" ? kind === "fuelDuty" || kind === "fuelVat" : SPENDING_KINDS.has(kind))),
    );
  // The rows other moving measures may move, besides spending ones
  const othersTouchIncome = othersMoving.some((other) => !other.kinds.length || other.kinds.some((kind) => !SPENDING_KINDS.has(kind)));

  if (has("fuelDuty") || has("fuelVat")) {
    if (fuelSpending > 0) steps.push(inputRow("fuel_spending", "Your petrol and diesel spending", fuelSpending));
  }
  if (has("electricityVat") && electricity > 0) {
    steps.push(inputRow("electricity_spending", "Your electricity spending", electricity));
  }

  // Fuel duty: the duty you pay (the API's), and VAT at 20% on the duty
  // saved, which together are the effect
  if (has("fuelDuty") && !parts) {
    const duty = row("fuel_duty");
    if (duty && moves(duty) && alone("fuel_duty")) {
      const vat = effectRaw - duty.change;
      parts = [fromSummary(duty, "Fuel duty you pay")];
      if (Math.abs(vat - 0.2 * duty.change) < MATCH_POUNDS && Math.abs(vat) >= SAME_CHANGE) {
        parts.push(worked("fuel_duty_vat", "VAT on the duty saved (20%)", null, null, vat));
      }
    }
  }

  // VAT on spending entered: the VAT inside it at the year's average rate,
  // before and after
  for (const [kind, spending, id, label] of [
    ["electricityVat", electricity, "electricity_vat", "VAT in your electricity spending"],
    ["fuelVat", fuelSpending, "fuel_vat", "VAT in your petrol and diesel spending"],
  ]) {
    const rate = param(kind, (item) => item.unit === "percent");
    if (parts || !rate || !(spending > 0)) continue;
    const before = vatIn(spending, rate.before);
    const after = vatIn(spending, rate.after);
    if (Math.abs(before - after - effectRaw) < MATCH_POUNDS) {
      parts = [worked(id, `${label} (${rateWords(rate.before)} → ${rateWords(rate.after)})`, -before, -after, before - after)];
    }
  }

  // Student loan: 9% of income above the threshold, when that is the API's
  // repayment before and after
  const loan = param("studentLoan");
  if (loan && !parts && typeof salaryUsed === "number" && h.student_loan_plan === studentLoanPlan(loan)) {
    const repayment = row("student_loan_repayments");
    const above = (threshold) => Math.max(0, salaryUsed - threshold);
    const before = above(loan.before);
    const after = above(loan.after);
    if (
      repayment &&
      Math.abs(STUDENT_LOAN_RATE * before - Math.abs(repayment.before)) < MATCH_POUNDS &&
      Math.abs(STUDENT_LOAN_RATE * after - Math.abs(repayment.after)) < MATCH_POUNDS
    ) {
      steps.push(inputRow("employment_income", "Your employment income", salaryUsed));
      steps.push(stepRow("income_above_threshold", "Income above the threshold", before, after));
      parts = [fromSummary(repayment, `Repayment (${Math.round(STUDENT_LOAN_RATE * 100)}% of income above the threshold)`)];
    }
  }

  // Employer NI: employers' total cost of employing you is held fixed, so
  // what they save on National Insurance is paid to you as higher pay. Only
  // with one earner, and only when 15% of pay above each threshold keeps
  // the API's pay at one total cost
  const employer = param("employerNi");
  if (employer && !parts && !(h.has_partner && Number(h.partner_employment_income) > 0)) {
    const pay = row("employment_income");
    if (pay && moves(pay)) {
      const ni = (amount, threshold) => EMPLOYER_NI_RATE * Math.max(0, amount - threshold);
      const before = ni(pay.before, employer.before);
      const after = ni(pay.after, employer.after);
      if (Math.abs(pay.before + before - (pay.after + after)) < MATCH_POUNDS) {
        steps.push(stepRow("employer_cost", "Your employer's cost of employing you", pay.before + before, pay.after + after));
        steps.push(stepRow("employer_ni", "Your employer's National Insurance (15% above the threshold)", before, after));
        const others = rows.filter(
          (item) => moves(item) && !item.parent && item.id !== "employment_income" && !SPENDING_ROWS.has(item.id),
        );
        const sum = pay.change + others.reduce((total, item) => total + item.change, 0);
        parts = [fromSummary(pay, "Your pay: the saving passed to you")];
        if (!othersTouchIncome && others.length && Math.abs(sum - effectRaw) < MATCH_POUNDS) {
          parts.push(...others.map((item) => fromSummary(item, `${item.label} on the higher pay`)));
        } else if (Math.abs(effectRaw - pay.change) >= SAME_CHANGE) {
          // With other measures moving the same rows, only the total taken back
          parts.push(worked("taken_back", "Taken back in tax and benefits on the higher pay", null, null, effectRaw - pay.change));
        }
      }
    }
  }

  // Income tax: income before tax, and how much of it is above each
  // threshold that changes (under £100,000, where the personal allowance
  // is not tapered)
  const total = income?.shown?.before;
  const allowance = param("incomeTaxThreshold", (item) => /personal allowance/i.test(item.label));
  const higher = param("incomeTaxThreshold", (item) => /higher rate threshold/i.test(item.label));
  if ((allowance || higher) && typeof total === "number" && total > 0 && total < 100000) {
    steps.push(inputRow("total_income", "Your income before tax", total));
    if (allowance && total > Math.min(allowance.before, allowance.after)) {
      steps.push(stepRow("above_allowance", "Income above the personal allowance", Math.max(0, total - allowance.before), Math.max(0, total - allowance.after)));
    }
    if (higher && total > Math.min(higher.before, higher.after)) {
      steps.push(stepRow("above_higher", "Income above the higher rate threshold", Math.max(0, total - higher.before), Math.max(0, total - higher.after)));
    }
  }

  // Over State Pension age: total income (the State Pension and all other
  // income) against the allowance
  const pensionAllowance = param("pensionAgeAllowance");
  if (pensionAllowance) {
    const statePension = row("state_pension");
    const all = (total ?? 0) + (statePension?.shown?.before ?? 0);
    if (all > 0) {
      steps.push(inputRow("total_income", "Your total income, State Pension included", all));
    }
  }

  // Income tax rates on unearned income: each income the rates apply to,
  // and the tax on each
  if (has("unearned") && !parts) {
    const types = [
      ["dividend", "dividend_income", "dividend_income_tax", "Your dividends"],
      ["savings", "savings_interest_income", "savings_income_tax", "Your savings interest"],
      ["property", "property_income", "property_income_tax", "Your property income"],
    ].filter(([word, incomeId]) => params.some((item) => item.label.toLowerCase().startsWith(word)) && row(incomeId)?.shown?.before > 0);
    for (const [, incomeId, , label] of types) steps.push(inputRow(incomeId, label, row(incomeId).shown.before));
    const taxes = types.map(([, , taxId]) => row(taxId)).filter((item) => item && moves(item));
    const sum = taxes.reduce((acc, item) => acc + item.change, 0);
    if (taxes.length && Math.abs(sum - effectRaw) < MATCH_POUNDS) {
      parts = taxes.map((item) => fromSummary(item, `Income tax ${item.label.charAt(0).toLowerCase()}${item.label.slice(1)}`));
    }
  }

  // Otherwise the Summary rows this measure moves: every moving row when it
  // is the only measure that changes the household; else the rows besides
  // spending ones, when no other moving measure can move them, or when they
  // add up to its effect
  if (!parts) {
    const own = rows.filter((item) => moves(item) && !item.parent);
    const spendingOnly = kinds.length > 0 && kinds.every((kind) => SPENDING_KINDS.has(kind));
    let candidates = null;
    if (!othersMoving.length) candidates = own;
    else if (!spendingOnly) candidates = own.filter((item) => !SPENDING_ROWS.has(item.id));
    if (candidates?.length) {
      const sum = candidates.reduce((acc, item) => acc + item.change, 0);
      if (Math.abs(sum - effectRaw) < MATCH_POUNDS) parts = candidates.map((item) => fromSummary(item));
    }
    // Or one row whose change is this measure's and no other's
    if (!parts) {
      const match = own.filter(
        (item) =>
          Math.abs(item.change - effectRaw) < SAME_CHANGE &&
          !othersMoving.some((other) => Math.abs(item.change - other.change) < SAME_CHANGE),
      );
      if (match.length === 1) parts = [fromSummary(match[0])];
    }
  }

  return { steps, parts };
}

// Employers' Class 1 National Insurance rate above the threshold. Only
// shown when it keeps the API's pay at one total cost, before and after.
export const EMPLOYER_NI_RATE = 0.15;

/**
 * A tab's parts in whole pounds that add up to its effect exactly
 * (largest remainder), each with its before and after; none unless they
 * add up to the effect before rounding, to within £1.
 */
export function reconcileParts(parts, effectRaw, effect) {
  if (!parts?.length) return [];
  const sum = parts.reduce((acc, part) => acc + part.raw, 0);
  if (Math.abs(sum - effectRaw) >= MATCH_POUNDS) return [];
  const rounded = consistentRound(
    parts.map((part) => part.raw),
    effect,
  );
  return parts.map((part, index) => {
    const before = part.before === null || part.before === undefined ? null : Math.round(part.before);
    return {
      ...part,
      change: rounded[index],
      before,
      after: before === null ? null : before + rounded[index],
    };
  });
}

/**
 * The policy tabs, one per measure that changes this household (in the
 * by_policy order), and the measures folded into "+N with no effect".
 *
 * @param {Object} options
 * @param {ReturnType<import("./singleYear").policyRows>} options.bars
 * @param {Array} options.groups - groupTotals(roundProgrammeGroups(...)), the Summary's rows
 * @param {Array} options.policies - The catalogue's measures
 * @param {Object|null} options.parameters - policy_parameters.json
 * @param {number} options.year
 * @param {Object|null} [options.household] - The request's household
 * @param {number|null} [options.salaryUsed] - The API's employment income for the year
 */
export function policyTabs({ bars, groups, policies, parameters, year, household = null, salaryUsed = null }) {
  if (!bars) return { tabs: [], noEffect: [] };
  const rows = [
    ...flatRows(groups),
    // The groups' own totals, as the Summary shows them (market income's)
    ...(groups ?? []).map((group) => ({ id: group.id, group: group.id, isGroup: true, shown: group.shown, change: group.shown?.change ?? 0 })),
  ];
  const measures = bars.all
    .filter((bar) => bar.id !== "interaction")
    .map((bar) => {
      const measure = policies.find((policy) => policy.id === bar.id) ?? { id: bar.id, name: bar.name, color: bar.color };
      const params = parameterRowsFor(parameters, measure, year);
      const kinds = [...new Set(params.map(parameterKind).filter(Boolean))];
      return { bar, measure, params, kinds: kinds.length ? kinds : kindsFromName(measure) };
    });
  const tabs = measures.map(({ bar, measure, params, kinds }) => {
    const othersMoving = measures
      .filter((other) => other.bar.id !== bar.id && Math.abs(other.bar.change) >= SAME_CHANGE)
      .map((other) => ({ kinds: other.kinds, change: other.bar.change }));
    const interaction = bars.all.find((item) => item.id === "interaction");
    if (interaction) othersMoving.push({ kinds: [], change: interaction.change });
    const { steps, parts } = householdSteps({
      params,
      kinds,
      household,
      salaryUsed,
      rows: rows.filter((item) => !item.isGroup || item.id === "income"),
      effectRaw: bar.change,
      othersMoving,
    });
    return {
      id: bar.id,
      measure,
      label: shortNameOf(measure),
      name: bar.name,
      parameters: shownParameters(params, rows),
      household: [...steps, ...reconcileParts(parts, bar.change, bar.rounded)],
      // The bars' whole pounds (policyRows), the Summary's split by policy
      effect: bar.rounded,
      how: howItWorks(measure),
    };
  });
  return { tabs, noEffect: bars.noEffectItems ?? [] };
}

// Rates on unearned income: only those on income the household has
const INCOME_OF = { dividend: "dividend_income", savings: "savings_interest_income", property: "property_income" };
function shownParameters(params, rows) {
  return params.filter((item) => {
    if (parameterKind(item) !== "unearned") return true;
    const word = item.label.split(" ")[0].toLowerCase();
    const income = rows.find((row) => row.id === INCOME_OF[word]);
    return Boolean(income && income.shown?.before > 0);
  });
}

/**
 * The tab's one line: policyDetails.js's summary while it describes the
 * published measure, else the first sentence of the published description
 * (without its "Candidate measure." label).
 */
export function howItWorks(measure) {
  const summary = policyDetailsFor(measure)?.summary;
  if (summary) return summary;
  const text = String(measure?.description ?? "")
    .replace(/^\s*Candidate measure\.\s*/i, "")
    .trim();
  if (!text || /not yet been published/i.test(text)) return null;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text);
  return sentence ? sentence[1] : text;
}

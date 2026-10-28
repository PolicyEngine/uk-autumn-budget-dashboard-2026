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
import { employeeNi, incomeTax } from "./incomeTaxBands";

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
  // A reduction in income tax (the Pension Tax Allowance): by its unit, a
  // sum of income tax, which policy_table.py gives a tax reduction only
  ["taxReduction", (row) => row.unit === "gbp" && /^£ of income tax\b/.test(row.unit_words ?? "")],
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
      return { kind: "parameter", id: row.label, label: row.label, unit: row.unit, unit_words: row.unit_words, note: row.note, before: point.before, after: point.after };
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
  // The Summary's own whole pounds for this row: the same amount is never
  // shown £1 apart in the two tabs (reconcileParts)
  pin: typeof row.shown?.change === "number" ? row.shown.change : null,
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
function householdSteps({ params, kinds, household, salaryUsed, rows: allRows, effectRaw, othersMoving, law }) {
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

  // A tax reduction: income tax without it, the largest reduction, what
  // the taper (or the tax due, as it is non-refundable) takes back, and
  // income tax with it. Only when the income tax row moves by no more
  // than the largest reduction
  const reduction = param("taxReduction");
  if (reduction && !parts) {
    const tax = row("income_tax");
    if (tax && moves(tax)) {
      const taxBefore = Math.abs(tax.before);
      const taxAfter = Math.abs(tax.after);
      const given = taxBefore - taxAfter;
      const largest = Number(reduction.after) || 0;
      if (given > 0 && given <= largest + SAME_CHANGE) {
        const withdrawn = Math.max(0, largest - given);
        steps.push(inputRow("tax_without_reduction", "Income tax without the reduction", taxBefore));
        steps.push(stepRow("tax_reduction_largest", reduction.label, 0, largest));
        if (withdrawn >= SAME_CHANGE) {
          // Non-refundable: all the tax due is taken off, and no more
          const limited = taxAfter < SAME_CHANGE;
          const taper = /reduced by (£1 for every £\d+[^;.]*)/i.exec(reduction.note ?? "")?.[1];
          const label = limited ? "Not used: more than the income tax due" : `Withdrawn by the taper${taper ? ` (${taper})` : ""}`;
          steps.push(stepRow(limited ? "tax_reduction_unused" : "tax_reduction_taper", label, 0, -withdrawn));
        }
        const taxPart = worked("income_tax_total", "Income tax", -taxBefore, -taxAfter, given);
        const sum = (list) => list.reduce((acc, part) => acc + part.raw, 0);
        if (Math.abs(given - effectRaw) < MATCH_POUNDS) parts = [taxPart];
        else if (!othersTouchIncome) {
          // The rest from the Summary rows it moves besides income tax
          // (Pension Credit, Council Tax Reduction), when nothing else can
          const others = rows.filter((item) => moves(item) && !item.parent && item.id !== "income_tax" && !SPENDING_ROWS.has(item.id));
          const all = [taxPart, ...others.map((item) => fromSummary(item))];
          if (Math.abs(sum(all) - effectRaw) < MATCH_POUNDS) parts = all;
        }
      }
    }
  }

  // Income tax and National Insurance band by band, for a measure that
  // changes them, when the bands give the API's own figures before the
  // measures (taxBandSteps)
  if (!parts && law && TAX_KINDS.some((kind) => has(kind)) && !h.has_partner) {
    const banded = taxBandSteps({ params, has, rows, law, effectRaw, othersTouchIncome });
    if (banded) {
      steps.push(...banded.steps);
      parts = banded.parts;
    }
  }

  // Employer NI: employers' total cost of employing you is held fixed, so
  // what they save on National Insurance is paid to you as higher pay. Only
  // with one earner, and only when 15% of pay above each threshold keeps
  // the API's pay at one total cost
  const employer = param("employerNi");
  if (employer && !(h.has_partner && Number(h.partner_employment_income) > 0)) {
    const pay = row("employment_income");
    if (pay && moves(pay)) {
      const ni = (amount, threshold) => EMPLOYER_NI_RATE * Math.max(0, amount - threshold);
      const before = ni(pay.before, employer.before);
      const after = ni(pay.after, employer.after);
      if (Math.abs(pay.before + before - (pay.after + after)) < MATCH_POUNDS) {
        steps.unshift(
          stepRow("employer_cost", "Your employer's cost of employing you", pay.before + before, pay.after + after),
          stepRow("employer_ni", "Your employer's National Insurance (15% above the threshold)", before, after),
        );
        if (parts) return { steps, parts };
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
  const banded = steps.some((step) => step.kind === "heading");
  if (!banded && (allowance || higher) && typeof total === "number" && total > 0 && total < 100000) {
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
  if (pensionAllowance && !banded) {
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
    if (!steps.some((step) => step.kind === "heading")) {
      for (const [, incomeId, , label] of types) steps.push(inputRow(incomeId, label, row(incomeId).shown.before));
    }
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
  const rounded = pinnedParts(parts, effect);
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
 * Whole pounds for a tab's parts that add up to `effect`, with each part
 * that is a Summary row at the Summary's own figure (its `pin`) and the
 * parts worked out here taking up the rounding. The employer NI tab's pay
 * was +£546 against the Summary's +£545 for the same £545.48 (2031-32,
 * part-time worker); now both say +£545 and the tab's income tax takes the
 * £1. Plain largest remainder when no part is free to take it, or the pins
 * leave the free parts more than £1 from their share.
 */
function pinnedParts(parts, effect) {
  const plain = () =>
    consistentRound(
      parts.map((part) => part.raw),
      effect,
    );
  const pinned = parts.map((part) => (typeof part.pin === "number" ? part.pin : null));
  const free = parts.map((_, index) => index).filter((index) => pinned[index] === null);
  const pinnedSum = pinned.reduce((acc, pin) => acc + (pin ?? 0), 0);
  if (free.length === parts.length) return plain();
  if (free.length === 0) return pinnedSum === effect ? pinned : plain();
  const freeRaw = free.map((index) => parts[index].raw);
  if (Math.abs(freeRaw.reduce((acc, value) => acc + value, 0) - (effect - pinnedSum)) > MATCH_POUNDS) return plain();
  const rest = consistentRound(freeRaw, effect - pinnedSum);
  const out = pinned.slice();
  free.forEach((index, i) => {
    out[index] = rest[i];
  });
  return out;
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
      law: lawFor(parameters, params, year),
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
      household: withPartsHeading(steps, reconcileParts(parts, bar.change, bar.rounded)),
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

// --- Income tax and National Insurance, band by band ------------------------

const TAX_KINDS = ["employerNi", "incomeTaxThreshold", "pensionAgeAllowance", "unearned"];
const UNEARNED_KEYS = {
  dividend: "dividends",
  savings: "savings",
  property: "property",
};
const BAND_OF = { ordinary: "basic", basic: "basic", upper: "higher", higher: "higher", additional: "additional" };

/**
 * Current law for `year`, and this measure's law: the thresholds and
 * rates from policy_parameters.json (any measure's "before" is current
 * law; this measure's "after" is its own). Null without a personal
 * allowance and basic rate band in the file.
 */
function lawFor(document, params, year) {
  const all = Object.values(document?.measures ?? {}).flatMap((entry) =>
    (entry.rows ?? []).map((row) => ({ label: row.label, point: (row.points ?? []).find((p) => p.key === String(year)) })),
  );
  const current = (test) => all.find((item) => item.point && test(item.label))?.point.before;
  const pa = current((label) => /^personal allowance$/i.test(label));
  const band = current((label) => /^basic rate band$/i.test(label));
  if (typeof pa !== "number" || typeof band !== "number") return null;
  const rates = { property: {}, savings: {}, dividends: {} };
  for (const item of all) {
    const match = /^(dividend|savings|property) (ordinary|basic|upper|higher|additional) rate$/i.exec(item.label);
    if (match && item.point) rates[UNEARNED_KEYS[match[1].toLowerCase()]][BAND_OF[match[2].toLowerCase()]] = item.point.before;
  }
  const before = { personalAllowance: pa, basicRateBand: band, rates };
  // This measure's own values
  const after = { personalAllowance: pa, basicRateBand: band, rates: structuredClone(rates) };
  for (const row of params) {
    if (/^personal allowance$/i.test(row.label) || parameterKind(row) === "pensionAgeAllowance") after.personalAllowance = row.after;
    if (/^basic rate band$/i.test(row.label)) after.basicRateBand = row.after;
    const match = /^(dividend|savings|property) (ordinary|basic|upper|higher|additional) rate$/i.exec(row.label);
    if (match) after.rates[UNEARNED_KEYS[match[1].toLowerCase()]][BAND_OF[match[2].toLowerCase()]] = row.after;
  }
  // The higher rate threshold, where the file gives it and no band
  const higher = params.find((row) => /^higher rate threshold$/i.test(row.label));
  if (higher && !params.some((row) => /^basic rate band$/i.test(row.label))) {
    after.basicRateBand = higher.after - after.personalAllowance;
  }
  const complete = (set) =>
    ["property", "savings", "dividends"].every((kind) => ["basic", "higher", "additional"].every((band) => typeof set[kind][band] === "number"));
  return { before, after, unearnedRates: complete(rates) && complete(after.rates) };
}

const KIND_WORDS = { earned: "Earnings and pensions", property: "Property income", savings: "Savings interest", dividends: "Dividends" };
const BAND_WORDS = {
  basic: "basic rate",
  higher: "higher rate",
  additional: "additional rate",
  starting: "starting rate for savings",
  allowance: null,
};
const percent = (rate) => `${Number((rate * 100).toFixed(2))}%`;
const rateText = (before, after) =>
  before === undefined ? percent(after) : after === undefined || Math.abs(before - after) < 1e-9 ? percent(before) : `${percent(before)} → ${percent(after)}`;

/**
 * The band-by-band steps and the tax parts, or null when the bands do not
 * give the API's income tax and National Insurance before the measures to
 * within £1, or the parts do not add up to the measure's effect.
 */
function taxBandSteps({ has, rows, law, effectRaw, othersTouchIncome }) {
  const row = (id) => rows.find((item) => item.id === id);
  const value = (id, side) => Math.abs(row(id)?.[side] ?? 0);
  const income = (side) => ({
    earned: value("employment_income", side) + value("private_pension_income", side) + value("state_pension", side),
    property: value("property_income", side),
    savings: value("savings_interest_income", side),
    dividends: value("dividend_income", side),
  });
  const before = income("before");
  // Only the employer NI threshold changes your pay; the rest change the law
  const after = has("employerNi") ? income("after") : before;
  if (!law.unearnedRates && (before.property || before.savings || before.dividends)) return null;
  const lawAfter = has("employerNi") ? law.before : law.after;
  const taxBefore = incomeTax(before, law.before);
  const taxAfter = incomeTax(after, lawAfter);
  if (Math.abs(taxBefore.total - value("income_tax", "before")) >= MATCH_POUNDS) return null;
  const pay = (side) => value("employment_income", side);
  const niLaw = (set) => ({ primaryThreshold: set.personalAllowance, upperEarningsLimit: set.personalAllowance + set.basicRateBand });
  const niBefore = employeeNi(pay("before"), niLaw(law.before));
  const niAfter = employeeNi(has("employerNi") ? pay("after") : pay("before"), niLaw(lawAfter));
  // National Insurance only where it moves, and only when the bands give the API's
  const niChecks =
    Math.abs(niBefore.total - niAfter.total) >= SAME_CHANGE &&
    Math.abs(niBefore.total - value("national_insurance", "before")) < MATCH_POUNDS;

  const steps = [];
  // The same incomes in the Summary's whole pounds, for the rows shown:
  // pay after is the Summary's before plus its change, so a step here and
  // the Summary's Employment income row never differ by £1
  const shownValue = (id, side) => Math.abs(row(id)?.shown?.[side] ?? row(id)?.[side] ?? 0);
  const shownIncome = (side) => ({
    earned: shownValue("employment_income", side) + shownValue("private_pension_income", side) + shownValue("state_pension", side),
    property: shownValue("property_income", side),
    savings: shownValue("savings_interest_income", side),
    dividends: shownValue("dividend_income", side),
  });
  const shownBefore = shownIncome("before");
  const shownAfter = has("employerNi") ? shownIncome("after") : shownBefore;
  // Your income of each kind (pay after, too, under the employer NI threshold)
  for (const kind of ["earned", "property", "savings", "dividends"]) {
    if (!before[kind] && !after[kind]) continue;
    const label = `Your ${KIND_WORDS[kind].charAt(0).toLowerCase()}${KIND_WORDS[kind].slice(1)}`;
    steps.push(
      before[kind] === after[kind]
        ? inputRow(`income_${kind}`, label, shownBefore[kind])
        : stepRow(`income_${kind}`, label, shownBefore[kind], shownAfter[kind]),
    );
  }
  steps.push({ kind: "heading", id: "tax_heading", label: "Income tax, band by band" });
  steps.push(stepRow("personal_allowance_used", "Your personal allowance (after any taper)", taxBefore.allowance, taxAfter.allowance));
  const keys = [];
  for (const slice of [...taxBefore.slices, ...taxAfter.slices]) {
    const key = `${slice.kind}:${slice.band}`;
    if (!keys.includes(key)) keys.push(key);
  }
  for (const key of keys) {
    const [kind, band] = key.split(":");
    const pick = (result) => result.slices.find((slice) => `${slice.kind}:${slice.band}` === key);
    const b = pick(taxBefore);
    const a = pick(taxAfter);
    const words = BAND_WORDS[band];
    const zero = band === "allowance" || band === "starting";
    const label = zero
      ? `${KIND_WORDS[kind]} in the ${words ?? (kind === "dividends" ? "dividend allowance" : "personal savings allowance")} (0%)`
      : `${KIND_WORDS[kind]} at the ${words} (${rateText(b?.rate, a?.rate)})`;
    steps.push(stepRow(`band_${key}`, label, b?.amount ?? 0, a?.amount ?? 0));
    if (!zero) {
      steps.push({ ...stepRow(`tax_${key}`, `Tax at ${rateText(b?.rate, a?.rate)}`, b?.tax ?? 0, a?.tax ?? 0), depth: 2 });
    }
  }
  if (niChecks) {
    steps.push({ kind: "heading", id: "ni_heading", label: "National Insurance, band by band" });
    steps.push(stepRow("ni_main", `Earnings between the thresholds (${percent(0.08)})`, niBefore.main, niAfter.main));
    if (niBefore.upper > 0 || niAfter.upper > 0) {
      steps.push(stepRow("ni_upper", `Earnings above the upper earnings limit (${percent(0.02)})`, niBefore.upper, niAfter.upper));
    }
  }

  const parts = [];
  if (has("employerNi") && row("employment_income")) {
    parts.push(fromSummary(row("employment_income"), "Your pay: the saving passed to you"));
  }
  parts.push(worked("income_tax_total", "Income tax", -taxBefore.total, -taxAfter.total, taxBefore.total - taxAfter.total));
  if (niChecks) {
    parts.push(worked("national_insurance_total", "National Insurance", -niBefore.total, -niAfter.total, niBefore.total - niAfter.total));
  }
  const sum = (list) => list.reduce((acc, part) => acc + part.raw, 0);
  if (Math.abs(sum(parts) - effectRaw) < MATCH_POUNDS) return { steps, parts };
  // The rest from the Summary rows the measure moves besides these, where
  // no other measure can move them (benefits, Council Tax Reduction)
  if (!othersTouchIncome) {
    const done = new Set(["employment_income", "income_tax", "national_insurance"]);
    const others = rows.filter((item) => moves(item) && !item.parent && !done.has(item.id) && !SPENDING_ROWS.has(item.id));
    const all = [...parts, ...others.map((item) => fromSummary(item))];
    if (others.length && Math.abs(sum(all) - effectRaw) < MATCH_POUNDS) return { steps, parts: all };
  }
  return null;
}

// After band-by-band headings, the parts of the effect under their own
// heading, so they do not read as another band
function withPartsHeading(steps, parts) {
  if (!parts.length || !steps.some((step) => step.kind === "heading")) return [...steps, ...parts];
  return [...steps, { kind: "heading", id: "parts_heading", label: "What it does to your net income" }, ...parts];
}

// The Summary row a tab's worked-out part belongs to (a part taken from the
// Summary is its own row)
const PART_ROW = {
  income_tax_total: "income_tax",
  national_insurance_total: "national_insurance",
  fuel_duty_vat: "vat_change",
  electricity_vat: "vat_change",
  fuel_vat: "vat_change",
};

/**
 * The table's By policy tab: the chart's own steps (policyRows(...).rows,
 * the same objects in the same order, the interaction row included), each
 * with the Summary rows its tab says it moves, in the Summary's names, and
 * the total, so the chart, this tab and the By tax and benefit tab show one
 * set of figures. When every policy's tab splits its effect into Summary
 * rows, what those leave of each Summary row is shown too: under the
 * interaction row when there is one, else as changes that cancel out (a
 * policy with no net effect can still move a tax and a benefit by the same
 * amount: State Pension protection for the pensioner in 2028-29, income tax
 * +£46 and Pension Credit −£46). Then every Summary row's change is the sum
 * of its parts here.
 *
 * @param {Object} options
 * @param {ReturnType<import("./singleYear").policyRows>} options.split
 * @param {Array} options.tabs - policyTabs(...).tabs
 * @param {Array} options.groups - The Summary's groups (groupTotals(roundProgrammeGroups(...)))
 * @param {{change: number}} options.totals - headlineTotals
 * @returns {{rows: Array<{id, name, label, rounded, parts: Array<{id, label, change}>}>, total: number, complete: boolean}}
 */
export function policyBridge({ split, tabs = [], groups = [], totals }) {
  const topRows = (groups ?? []).flatMap((group) => group.rows ?? []);
  const parentOf = new Map(topRows.flatMap((row) => (row.children ?? []).map((child) => [child.id, row.id])));
  const rowOf = (id) => {
    const target = PART_ROW[id] ?? id;
    return topRows.some((row) => row.id === target) ? target : (parentOf.get(target) ?? null);
  };
  const labelOf = new Map(topRows.map((row) => [row.id, row.label]));
  const byTab = new Map(tabs.map((tab) => [tab.id, tab]));
  let complete = true;
  const assigned = new Map();
  const steps = (split?.rows ?? []).map((step) => {
    if (step.id === "interaction") return { ...step, parts: [] };
    const tabParts = (byTab.get(step.id)?.household ?? []).filter((item) => item.kind === "part");
    // Each part under its Summary row, two parts on one row (fuel duty's
    // VAT and electricity's) added together
    const sums = new Map();
    for (const part of tabParts) {
      const id = rowOf(part.id);
      if (!id) {
        complete = false;
        continue;
      }
      sums.set(id, (sums.get(id) ?? 0) + part.change);
    }
    if (!tabParts.length || tabParts.some((part) => !rowOf(part.id))) complete = false;
    for (const [id, change] of sums) assigned.set(id, (assigned.get(id) ?? 0) + change);
    const parts = [...sums]
      .filter(([, change]) => change !== 0)
      .map(([id, change]) => ({ id, label: labelOf.get(id) ?? id, change }));
    return { ...step, parts };
  });
  if (complete) {
    const rest = topRows
      .map((row) => ({ id: row.id, label: row.label, change: (row.shown?.change ?? 0) - (assigned.get(row.id) ?? 0) }))
      .filter((row) => row.change !== 0);
    if (rest.length) {
      const interaction = steps.find((step) => step.id === "interaction");
      if (interaction) interaction.parts = rest;
      else steps.push({ id: "cancel_out", name: "Changes that cancel out", label: "Changes that cancel out", rounded: 0, parts: rest });
    }
  }
  return { rows: steps, total: totals?.change ?? steps.reduce((acc, step) => acc + step.rounded, 0), complete };
}

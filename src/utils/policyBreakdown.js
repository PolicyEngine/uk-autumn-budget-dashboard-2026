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

// A table row's change is a measure's when they agree to within the API's
// penny rounding (singleYear.js pinnedRound's tolerance)
const SAME_CHANGE = 0.025;

// The student loan repayment rate on income above the threshold (Plans 1,
// 2, 4 and 5). Only ever shown when the page's 9% of the income above the
// threshold matches the API's repayment, before and after, to within £1.
export const STUDENT_LOAN_RATE = 0.09;
const MATCH_POUNDS = 1;

// Road fuel, not the Winter Fuel Payment
const isFuel = (row) =>
  row.unit === "pence_per_litre" || (/\b(fuel|petrol|diesel)\b/i.test(row.label) && !/winter fuel/i.test(row.label));
const isElectricity = (row) => /electricity/i.test(row.label);
const studentLoanPlan = (row) => {
  const match = /plan\s*(\d)\b.*repayment threshold/i.exec(row.label);
  return match ? `PLAN_${match[1]}` : null;
};
const isIncomeTaxThreshold = (row) =>
  row.unit === "gbp" && !studentLoanPlan(row) && /(allowance|rate threshold|rate band)/i.test(row.label);

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

/**
 * The Summary's rows (roundProgrammeGroups, with their whole pounds) that
 * this measure alone moves: every moving row when it is the only measure
 * that changes the household's net income, else a row whose change is this
 * measure's and no other's. None where that cannot be told.
 */
export function attributedRows(groups, bars, barId) {
  const rows = (groups ?? []).flatMap((group) => group.rows ?? []);
  const measures = (bars?.all ?? []).filter((bar) => bar.id !== "interaction");
  const moving = measures.filter((bar) => Math.abs(bar.change) >= SAME_CHANGE);
  const interaction = (bars?.all ?? []).find((bar) => bar.id === "interaction");
  const own = measures.find((bar) => bar.id === barId);
  if (!own || Math.abs(own.change) < SAME_CHANGE) return [];
  if (moving.length === 1 && moving[0].id === barId && !interaction) {
    return rows.filter((row) => Math.abs(row.change) >= SAME_CHANGE || (row.shown && row.shown.change !== 0));
  }
  return rows.filter((row) => {
    if (Math.abs(row.change - own.change) >= SAME_CHANGE) return false;
    return !moving.some((bar) => bar.id !== barId && Math.abs(row.change - bar.change) < SAME_CHANGE);
  });
}

const inputRow = (id, label, value) => ({ kind: "input", id, label, before: value, after: value });

/**
 * The household's own inputs and checked steps for one measure's
 * parameters (the API's figures only; nothing the page cannot check).
 */
function householdSteps({ params, measure, household, salaryUsed, programmeRows }) {
  const steps = [];
  const seen = new Set();
  const once = (row) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    steps.push(row);
  };
  const h = household ?? {};
  const fuelSpending = (Number(h.petrol_spending) || 0) + (Number(h.diesel_spending) || 0);
  const usedRows = new Set();

  // Without the measure's parameters (none in the file, or a measure
  // changed since it was built), the spending it works on from its name or
  // category, so a fuel or electricity measure still shows what was entered
  const named = [measure?.name, measure?.label, measureCategoryOf(measure).label].filter(Boolean).join(" ");
  const kinds = params.length ? params : [{ label: named, unit: null }].filter((row) => isFuel(row) || isElectricity(row));
  for (const param of kinds) {
    if (isFuel(param) && fuelSpending > 0) {
      once(inputRow("fuel_spending", "Petrol and diesel spending (as entered)", fuelSpending));
    } else if (isElectricity(param) && Number(h.electricity_spending) > 0) {
      once(inputRow("electricity_spending", "Electricity spending (as entered)", Number(h.electricity_spending)));
    } else if (studentLoanPlan(param) && typeof salaryUsed === "number") {
      if (h.student_loan_plan !== studentLoanPlan(param)) continue;
      const repayment = programmeRows.find((row) => row.id === "student_loan_repayments");
      const above = (threshold) => Math.max(0, salaryUsed - threshold);
      const before = above(param.before);
      const after = above(param.after);
      // Only when 9% of it is the API's repayment, before and after
      const checks =
        repayment &&
        Math.abs(STUDENT_LOAN_RATE * before - Math.abs(repayment.raw.before)) < MATCH_POUNDS &&
        Math.abs(STUDENT_LOAN_RATE * after - Math.abs(repayment.raw.after)) < MATCH_POUNDS;
      if (!checks) continue;
      once(inputRow("employment_income", "Your employment income", salaryUsed));
      once({ kind: "step", id: "income_above_threshold", label: "Income above the threshold", before, after });
      usedRows.add(repayment.id);
      once({ ...repayment, label: `Repayment (${Math.round(STUDENT_LOAN_RATE * 100)}% of income above the threshold)` });
    } else if (isIncomeTaxThreshold(param) && typeof salaryUsed === "number" && salaryUsed > 0) {
      once(inputRow("employment_income", "Your employment income", salaryUsed));
    }
  }
  for (const row of programmeRows) {
    if (!usedRows.has(row.id)) once(row);
  }
  return steps;
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
  const tabs = bars.all
    .filter((bar) => bar.id !== "interaction")
    .map((bar) => {
      const measure = policies.find((policy) => policy.id === bar.id) ?? { id: bar.id, name: bar.name, color: bar.color };
      const params = parameterRowsFor(parameters, measure, year);
      const programmeRows = attributedRows(groups, bars, bar.id).map((row) => ({
        kind: "programme",
        id: row.id,
        label: row.label,
        changeOnly: row.changeOnly,
        before: row.shown.before,
        after: row.shown.after,
        change: row.shown.change,
        raw: { before: row.before, after: row.after },
      }));
      return {
        id: bar.id,
        measure,
        label: shortNameOf(measure),
        name: bar.name,
        parameters: params,
        household: householdSteps({ params, measure, household, salaryUsed, programmeRows }),
        // The bars' whole pounds (policyRows), the Summary's split by policy
        effect: bar.rounded,
        how: policyDetailsFor(measure)?.summary ?? null,
      };
    });
  return { tabs, noEffect: bars.noEffectItems ?? [] };
}

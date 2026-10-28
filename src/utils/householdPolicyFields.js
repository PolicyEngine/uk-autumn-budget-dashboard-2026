import { atStatePensionAge } from "./householdImpactApi";

/**
 * Which of the Household calculator's answers each policy reads, by
 * measure id, so the form asks those up front ("Questions that matter for
 * the selected policies") and leaves the rest under More details.
 *
 * One row per measure: `fields` are the form's field ids (as in
 * HouseholdCalculator's FORM_SECTIONS); `when(inputs, year, field)`
 * (optional) says whether the measure reads that field for these answers.
 * The rows' order is the questions' order. Fields the essentials already
 * ask (age, salary) need no row: they are asked anyway. A measure with no
 * row, or none of whose fields apply, adds nothing. Only fields the
 * household request already sends can be listed (buildHouseholdRequest).
 *
 * To add a measure: add its id here with the answers its effect depends on.
 *
 * Like POLICY_DETAILS, this belongs in the published manifest (reforms.py)
 * in time, so the page keeps no measure list of its own; until then a row
 * only moves questions, and decides nothing about which measures exist.
 */
export const POLICY_FIELDS = {
  // Fuel duty frozen: what the household spends on petrol and diesel
  fuel_duty_rise_deferral: { fields: ["petrol_spending_per_year", "diesel_spending_per_year"] },
  // Zero VAT on domestic electricity: its electricity bill
  domestic_electricity_zero_vat: { fields: ["electricity_spending_per_year"] },
  // Warm Home Discount top-up: paid with Universal Credit or Pension
  // Credit, so whether the household claims what it is entitled to
  warm_home_discount_top_up: { fields: ["claims_universal_credit"] },
  // Plan 2 threshold: which loan, if any
  plan_2_threshold_unfreeze: { fields: ["student_loan_plan"] },
  // +2pp on dividend, savings and property income
  unearned_income_rates_up: {
    fields: ["dividends_per_year", "savings_interest_per_year", "property_income_per_year"],
  },
  // State Pension protection: for each adult at State Pension age, their
  // State Pension and any private pension (which takes the allowance away)
  state_pension_income_tax_protection: {
    fields: [
      "state_pension_per_year",
      "partner_state_pension_per_year",
      "private_pension_per_year",
      "partner_private_pension_per_year",
    ],
    when: (inputs, year, field) =>
      field.startsWith("partner_")
        ? Boolean(inputs.has_partner) && atStatePensionAge(inputs.partner_age, year)
        : atStatePensionAge(inputs.current_age, year),
  },
  // Carer's Allowance taper: whether you care for someone, and how many
  // hours a week (the allowance needs 35)
  // (the hours only for a carer: HouseholdCalculator's FIELD_APPLIES)
  carers_allowance_earnings_taper: { fields: ["is_carer", "care_hours_per_week"] },
  // The threshold freeze to 2031-32 and the employer National Insurance
  // threshold read the salary, which the essentials ask
};

/**
 * The questions the selected policies read, in the table's order, each
 * with the selected policies that read it (in the selection's order):
 * [{ id, policies: [policyId, ...] }]. `applies(id)` drops fields that do
 * not apply to the answers (a partner's pension without a partner).
 */
export function policyQuestions(selected, { inputs, year, applies = () => true, table = POLICY_FIELDS }) {
  const byField = new Map();
  for (const [policyId, row] of Object.entries(table)) {
    if (!selected.includes(policyId)) continue;
    for (const field of row.fields) {
      if (row.when && !row.when(inputs, year, field)) continue;
      if (!applies(field)) continue;
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field).push(policyId);
    }
  }
  return [...byField].map(([id, policies]) => ({
    id,
    policies: selected.filter((policyId) => policies.includes(policyId)),
  }));
}

import { atStatePensionAge } from "./householdImpactApi";

/**
 * Which of the Household calculator's answers each policy reads, by
 * measure id, so the form asks those up front ("Questions that matter for
 * the selected policies") first in their step and leaves the rest under its
 * "Other questions".
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
  // Property income tax rates: property income
  property_income_rates_up: { fields: ["property_income_per_year"] },
  // Savings income tax rates: savings interest
  savings_income_rates_up: { fields: ["savings_interest_per_year"] },
  // Pension Tax Allowance: for each adult at State Pension age, their
  // State Pension and any private pension (total income above the full new
  // State Pension tapers the reduction away)
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
  // Household energy payment: households in England in Council Tax bands
  // A to D, so the band, where the region is in England
  household_energy_payment_2026: {
    fields: ["council_tax_band"],
    when: (inputs) => !["SCOTLAND", "WALES", "NORTHERN_IRELAND"].includes(inputs.region),
  },
  // Carer's Allowance taper: whether you care for someone, and how many
  // hours a week (the allowance needs 35); the hours only for a carer
  // (HouseholdCalculator's FIELD_APPLIES)
  carers_allowance_earnings_taper: { fields: ["is_carer", "care_hours_per_week"] },
  // Trading allowance £1,000 to £3,000: self-employment or side income,
  // its receipts and allowable expenses (the allowance replaces the
  // expenses when larger)
  trading_allowance_raise: {
    fields: ["self_employment_receipts_per_year", "self_employment_expenses_per_year"],
  },
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

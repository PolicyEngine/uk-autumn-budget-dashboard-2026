/**
 * The Household impact form's answers and the shared UK household model
 * (policyengine-household-wizard's `UKHouseholdDraft`), each from the other.
 *
 * The form keeps its answers flat, one per field id (WIZARD_DEFAULTS'
 * keys), and the children's ages as the text the form shows ("5, 3").
 * Everything about what a household is (its defaults, the rules for
 * children and the State Pension, and the request to the household API)
 * is the package's; this file only moves answers between the two shapes,
 * and passes each value as it is, so the request is the one the answers
 * always gave (src/utils/householdRequestIdentity.test.js).
 */
import { UK_SALARY_YEAR } from "policyengine-household-wizard/uk-household";

/**
 * Children's ages from the form's text ("5, 3, 1"). An age of 20 or over
 * is kept, not dropped, so the calculation refuses it with a message
 * rather than leaving the child out silently.
 */
export function parseChildrenAges(value) {
  if (!value || String(value).trim() === "") return [];
  return String(value)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

/** The form's answers as a draft. */
export function draftFromAnswers(inputs) {
  const education = Array.isArray(inputs.children_in_education) ? inputs.children_in_education : [];
  return {
    salaryYear: UK_SALARY_YEAR,
    region: inputs.region,
    head: {
      age: inputs.current_age,
      employmentIncome: inputs.current_salary,
      privatePensionIncome: inputs.private_pension_per_year,
      statePension: inputs.state_pension_per_year,
      studentLoanPlan: inputs.student_loan_plan,
      salarySacrificePensionContributions: inputs.salary_sacrifice_per_year,
      dividendIncome: inputs.dividends_per_year,
      savingsInterestIncome: inputs.savings_interest_per_year,
      propertyIncome: inputs.property_income_per_year,
    },
    hasPartner: inputs.has_partner,
    partner: {
      age: inputs.partner_age,
      employmentIncome: inputs.partner_salary,
      privatePensionIncome: inputs.partner_private_pension_per_year,
      statePension: inputs.partner_state_pension_per_year,
    },
    // Each child's education answer is the one at their place in the list
    children: parseChildrenAges(inputs.children_ages).map((age, index) => ({ age, inEducation: education[index] })),
    tenure: inputs.tenure,
    monthlyRent: inputs.monthly_rent,
    councilTaxBand: inputs.council_tax_band,
    claimsUniversalCredit: inputs.claims_universal_credit,
    monthlyChildcare: inputs.monthly_childcare,
    spending: {
      petrol: inputs.petrol_spending_per_year,
      diesel: inputs.diesel_spending_per_year,
      electricity: inputs.electricity_spending_per_year,
    },
  };
}

/**
 * A draft as the form's answers. A child's education answer becomes the
 * form's yes or no (yes until answered), as the form stores it.
 */
export function answersFromDraft(draft) {
  return {
    current_age: draft.head.age,
    current_salary: draft.head.employmentIncome,
    region: draft.region,
    tenure: draft.tenure,
    monthly_rent: draft.monthlyRent,
    student_loan_plan: draft.head.studentLoanPlan,
    has_partner: draft.hasPartner,
    partner_age: draft.partner.age,
    partner_salary: draft.partner.employmentIncome,
    children_ages: draft.children.map((child) => child.age).join(", "),
    children_in_education: draft.children.map((child) => child.inEducation !== false),
    claims_universal_credit: draft.claimsUniversalCredit,
    council_tax_band: draft.councilTaxBand,
    salary_sacrifice_per_year: draft.head.salarySacrificePensionContributions,
    petrol_spending_per_year: draft.spending.petrol,
    diesel_spending_per_year: draft.spending.diesel,
    electricity_spending_per_year: draft.spending.electricity,
    dividends_per_year: draft.head.dividendIncome,
    savings_interest_per_year: draft.head.savingsInterestIncome,
    property_income_per_year: draft.head.propertyIncome,
    private_pension_per_year: draft.head.privatePensionIncome,
    partner_private_pension_per_year: draft.partner.privatePensionIncome,
    monthly_childcare: draft.monthlyChildcare,
    state_pension_per_year: draft.head.statePension,
    partner_state_pension_per_year: draft.partner.statePension,
  };
}

/**
 * Shared policy configuration for colors and labels across all charts.
 *
 * Color scheme:
 * - Teal/green spectrum: policies that are GOOD for households (costs to treasury)
 * - Amber/orange spectrum: policies that are BAD for households (revenue raisers)
 */

import { POLICIES } from "./policies";

// Policy colours by display name (used in population impact charts), from
// the Autumn Budget 2025 dashboard's theme: raise revenue in its amber
// family, cost revenue in its teal family (Tailwind's amber and teal
// scales). Raise revenue runs darkest to lightest, two steps apart, as last
// year's did. Cost revenue has seven measures, more than last year's four,
// so its shades alternate dark and light down the stack (each neighbour at
// least three steps apart) to keep neighbouring bars distinct. The names are
// the measures' names in src/utils/policies.js.
export const POLICY_COLORS = {
  // Raise revenue (amber)
  "Threshold freeze to 2031-32": "#78350F", // Amber 900
  "Business Asset Disposal Relief restricted": "#B45309", // Amber 700

  // Cost revenue (teal)
  "Fuel duty rises deferred": "#115E59", // Teal 800
  "VAT cut on road fuel": "#2DD4BF", // Teal 400
  "Zero VAT on domestic electricity": "#0F766E", // Teal 700
  "Warm Home Discount top-up": "#5EEAD4", // Teal 300
  "State Pension income tax protection": "#0D9488", // Teal 600
  "Employer NI relief for under-25s": "#99F6E4", // Teal 200
  "Plan 2 student loan threshold unfrozen": "#14B8A6", // Teal 500
};

// Policy colours by measure id (personal impact), the same as by name
export const POLICY_COLORS_BY_KEY = Object.fromEntries(
  POLICIES.map((policy) => [policy.id, POLICY_COLORS[policy.name]]),
);

// Each measure's icon, by measure id (so catalogue data can use it too),
// chosen by the tax or benefit it changes (TitleIcon names). A new measure
// picks the icon of its type from POLICY_TYPE_ICONS.
export const POLICY_TYPE_ICONS = {
  incomeTax: "receipt",
  capitalGainsTax: "briefcase",
  fuelDuty: "fuel",
  vat: "tag",
  electricityVat: "bolt",
  energyBenefit: "flame",
  pension: "clock",
  employerNi: "building",
  studentLoan: "cap",
};

export const POLICY_ICONS = {
  threshold_freeze_2031_32: POLICY_TYPE_ICONS.incomeTax,
  badr_lifetime_limit_cut: POLICY_TYPE_ICONS.capitalGainsTax,
  fuel_duty_rise_deferral: POLICY_TYPE_ICONS.fuelDuty,
  road_fuel_vat_cut: POLICY_TYPE_ICONS.vat,
  domestic_electricity_zero_vat: POLICY_TYPE_ICONS.electricityVat,
  warm_home_discount_top_up: POLICY_TYPE_ICONS.energyBenefit,
  state_pension_income_tax_protection: POLICY_TYPE_ICONS.pension,
  employer_ni_relief_under_25s: POLICY_TYPE_ICONS.employerNi,
  plan_2_threshold_unfreeze: POLICY_TYPE_ICONS.studentLoan,
};

// Order: revenue raisers first (positive for gov), then costs (negative for gov)
export const ALL_POLICY_NAMES = [
  // Raise revenue
  "Threshold freeze to 2031-32",
  "Business Asset Disposal Relief restricted",
  // Cost revenue
  "Fuel duty rises deferred",
  "VAT cut on road fuel",
  "Zero VAT on domestic electricity",
  "Warm Home Discount top-up",
  "State Pension income tax protection",
  "Employer NI relief for under-25s",
  "Plan 2 student loan threshold unfrozen",
];

// Measures that raise revenue (the rest of ALL_POLICY_NAMES cost revenue),
// for the legends' two groups
export const REVENUE_RAISING_NAMES = new Set([
  "Threshold freeze to 2031-32",
  "Business Asset Disposal Relief restricted",
]);

// The id of the run that simulates every measure together
// (reforms.AUTUMN_BUDGET_2026_COMBINED_ID). Statistics that cannot be added
// up across measures, such as the share of people better off, are read from
// it when every policy is selected.
export const COMBINED_REFORM_ID = "autumn_budget_2026_combined";

// Household impact (household API) policy order: the candidate measures
export const PERSONAL_IMPACT_POLICY_ORDER = [
  "fuel_duty_rise_deferral",
  "state_pension_income_tax_protection",
  "warm_home_discount_top_up",
  "domestic_electricity_zero_vat",
  "employer_ni_relief_under_25s",
  "threshold_freeze_2031_32",
  "badr_lifetime_limit_cut",
  "road_fuel_vat_cut",
  "plan_2_threshold_unfreeze",
];

// Helper to get color by policy key
export function getPolicyColor(key) {
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || "#9CA3AF";
}

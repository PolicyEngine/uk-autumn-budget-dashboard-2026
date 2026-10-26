/**
 * Shared policy configuration for colors and labels across all charts.
 *
 * Color scheme (POLICY_COLORS): amber ramp for revenue raisers, teal ramp
 * for measures that cost revenue, each darkest for the largest measure.
 */

import { POLICIES } from "./policies";
import { POLICY_RAMPS } from "./chartTheme";

// Measures that raise revenue (the rest of ALL_POLICY_NAMES cost revenue),
// for the legends' two groups
export const REVENUE_RAISING_NAMES = new Set([
  "Dividend tax rates up 1 point",
  "Threshold freeze to 2031-32",
  "Business Asset Disposal Relief restricted",
  "UC standard allowance uprated below CPI",
  "Capital gains tax main rates up 2 points",
  "Council tax surcharge from £1.5m",
]);

// Order: revenue raisers first (positive for gov), then costs (negative for
// gov); within each group by size, largest first: the mean absolute £bn of
// the full package over the years shown (budgetary_impact.csv, 2026-27 to
// 2031-32). Every stacked chart stacks in this order (largest nearest
// zero), and its legend and tooltip list it. policyConfig.test.js checks
// the order against the published file, so a re-run that changes the
// ranking fails until this list is updated.
export const ALL_POLICY_NAMES = [
  // Raise revenue (DRILL 5 new pair, mean £bn a year, 2026-27 to 2031-32)
  "Dividend tax rates up 1 point", // £0.77bn
  "Threshold freeze to 2031-32", // £0.68bn
  "Business Asset Disposal Relief restricted", // £0.32bn
  "UC standard allowance uprated below CPI", // £0.21bn
  "Capital gains tax main rates up 2 points", // £0.16bn
  "Council tax surcharge from £1.5m", // £0.16bn
  // Cost revenue
  "Employer NI relief for under-25s", // £5.32bn
  "Employer NI threshold raised by £1,000", // £3.62bn
  "State Pension income tax protection, extended", // £1.80bn
  "Local Housing Allowance reset in April 2027", // £1.26bn
  "Fuel duty rises deferred", // £0.60bn
  "Zero VAT on domestic electricity", // £0.37bn
  "Zero VAT on domestic gas", // £0.16bn
  "State Pension income tax protection", // £0.14bn
  "Warm Home Discount top-up", // £0.09bn
];

// Policy colours by display name, the same on every chart and card: each
// group's ramp (chartTheme.js POLICY_RAMPS, the --ramp-* tokens) taken in
// the order above, so the largest measure is darkest and each smaller one
// a step lighter: ambers for raise revenue, teals for cost revenue.
export const POLICY_COLORS = Object.fromEntries(
  [true, false].flatMap((raises) =>
    ALL_POLICY_NAMES.filter((name) => REVENUE_RAISING_NAMES.has(name) === raises).map(
      (name, index) => {
        const ramp = raises ? POLICY_RAMPS.raise : POLICY_RAMPS.cost;
        return [name, ramp[Math.min(index, ramp.length - 1)]];
      },
    ),
  ),
);

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
  uc_standard_allowance_below_cpi: POLICY_TYPE_ICONS.energyBenefit,
  state_pension_income_tax_protection_extended: POLICY_TYPE_ICONS.pension,
  employer_ni_secondary_threshold_raised: POLICY_TYPE_ICONS.employerNi,
  cgt_main_rates_up_2pp: POLICY_TYPE_ICONS.capitalGainsTax,
  council_tax_surcharge_from_1_5m: POLICY_TYPE_ICONS.incomeTax,
  lha_reset_april_2027: POLICY_TYPE_ICONS.energyBenefit,
  dividend_rates_up_1pp: POLICY_TYPE_ICONS.incomeTax,
  domestic_gas_zero_vat: POLICY_TYPE_ICONS.vat,
};

// The id of the run that simulates every measure together
// (reforms.AUTUMN_BUDGET_2026_COMBINED_ID). Statistics that cannot be added
// up across measures, such as the share of people better off, are read from
// it when every policy is selected.
export const COMBINED_REFORM_ID = "autumn_budget_2026_combined";

// Household impact (household API) policy order: the candidate measures
export const PERSONAL_IMPACT_POLICY_ORDER = POLICIES.map((policy) => policy.id);

// Helper to get color by policy key
export function getPolicyColor(key) {
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || "#9CA3AF";
}

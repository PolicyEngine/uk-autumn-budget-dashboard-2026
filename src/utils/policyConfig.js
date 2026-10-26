/**
 * Shared policy configuration for colors and labels across all charts.
 *
 * Color scheme (POLICY_COLORS): amber ramp for revenue raisers, teal ramp
 * for measures that cost revenue, each darkest for the largest measure.
 */

import { POLICIES } from "./policies";
import { CHART_COLOURS, POLICY_RAMPS } from "./chartTheme";

// Measures that raise revenue (the rest of ALL_POLICY_NAMES cost revenue),
// for the legends' two groups
export const REVENUE_RAISING_NAMES = new Set([
  "Threshold freeze to 2031-32",
  "Business Asset Disposal Relief restricted",
]);

// Order: revenue raisers first (positive for gov), then costs (negative for
// gov); within each group by size, largest first: the mean absolute £bn of
// the full package over the years shown (budgetary_impact.csv, 2026-27 to
// 2031-32). Every stacked chart stacks in this order (largest nearest
// zero), and its legend and tooltip list it. policyConfig.test.js checks
// the order against the published file, so a re-run that changes the
// ranking fails until this list is updated.
export const ALL_POLICY_NAMES = [
  // Raise revenue
  "Threshold freeze to 2031-32", // £0.69bn a year on average
  "Business Asset Disposal Relief restricted", // £0.32bn
  // Cost revenue
  "Employer NI relief for under-25s", // £5.46bn
  "Fuel duty rises deferred", // £0.57bn
  "Zero VAT on domestic electricity", // £0.36bn
  "Plan 2 student loan threshold unfrozen", // £0.35bn
  "State Pension income tax protection", // £0.16bn
  "VAT cut on road fuel", // £0.13bn
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
  plan_2_threshold_unfreeze: POLICY_TYPE_ICONS.studentLoan,
};

// Each measure's short name, for headlines and tight labels (the legends
// keep the full name from policies.js). One list, by measure id.
export const POLICY_SHORT_NAMES = {
  plan_2_threshold_unfreeze: "Plan 2 threshold unfrozen",
  state_pension_income_tax_protection: "State Pension protection",
  employer_ni_relief_under_25s: "Employer NI relief, under-25s",
  fuel_duty_rise_deferral: "Fuel duty deferral",
  domestic_electricity_zero_vat: "Zero VAT on electricity",
  road_fuel_vat_cut: "Road fuel VAT cut",
  warm_home_discount_top_up: "Warm Home Discount top-up",
  threshold_freeze_2031_32: "Threshold freeze",
  badr_lifetime_limit_cut: "BADR restricted",
};

/** A measure's short name by id, or its full name where it has none. */
export function shortName(id) {
  return POLICY_SHORT_NAMES[id] ?? POLICIES.find((policy) => policy.id === id)?.name ?? id;
}

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
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || CHART_COLOURS.noChange;
}

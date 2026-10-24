/**
 * Shared policy configuration for colors and labels across all charts.
 *
 * Color scheme:
 * - Teal/green spectrum: policies that are GOOD for households (costs to treasury)
 * - Amber/orange spectrum: policies that are BAD for households (revenue raisers)
 */

// Policy colours by display name (used in population impact charts).
// Raise revenue: amber, darkest to lightest. Cost revenue: teal, with the
// chart palette's blue-grey, steel blue and mint between, so that adjacent
// bars stay distinct. The names are the measures' names in src/utils/policies.js.
export const POLICY_COLORS = {
  // Raise revenue (amber)
  "Threshold freeze to 2031-32": "#78350F", // Amber 900
  "Business Asset Disposal Relief restricted": "#B45309", // Amber 700
  "Salary sacrifice cap from 2028": "#F59E0B", // Amber 500

  // Cost revenue (teal, with blue and mint so neighbours stay apart)
  "Fuel duty rises deferred": "#115E59", // Teal 800
  "VAT cut on road fuel": "#5FB88A", // Mint
  "Zero VAT on domestic electricity": "#0D9488", // Teal 600
  "Warm Home Discount top-up": "#5A8FB8", // Blue-grey
  "State Pension income tax protection": "#2DD4BF", // Teal 400
  "Employer NI relief for under-25s": "#4A7BA7", // Steel blue
  "Plan 2 student loan threshold unfrozen": "#99F6E4", // Teal 200
};

// Policy colours by API key (lifecycle calculator and personal impact).
// The lifecycle model still costs last year's measures (its own
// hand-typed policy values), so its keys keep their colours until it is
// rebuilt on the candidates.
export const POLICY_COLORS_BY_KEY = {
  impact_two_child_limit: "#0D9488",
  impact_fuel_duty_freeze: "#14B8A6",
  impact_rail_fare_freeze: "#2DD4BF",
  impact_threshold_freeze: "#78350F",
  impact_unearned_income_tax: "#B45309",
  impact_salary_sacrifice_cap: "#F59E0B",
  impact_sl_threshold_freeze: "#FBBF24",
};

// Order: revenue raisers first (positive for gov), then costs (negative for gov)
export const ALL_POLICY_NAMES = [
  // Raise revenue
  "Threshold freeze to 2031-32",
  "Business Asset Disposal Relief restricted",
  "Salary sacrifice cap from 2028",
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
  "Salary sacrifice cap from 2028",
]);

// The id of the run that simulates every measure together
// (reforms.AUTUMN_BUDGET_2026_COMBINED_ID). Statistics that cannot be added
// up across measures, such as the share of people better off, are read from
// it when every policy is selected.
export const COMBINED_REFORM_ID = "autumn_budget_2026_combined";

// Lifecycle calculator reform configuration
// Note: In lifecycle view, we show impact FROM HOUSEHOLD PERSPECTIVE
// (positive = good for household, negative = bad)
export const LIFECYCLE_REFORMS = [
  // The dashboard's policy names, in its legend order: raisers, then costs.
  // The lifecycle model taxes dividends, savings and property income as one
  // item, so they share one entry.
  {
    key: "impact_threshold_freeze",
    label: "Threshold freeze extension",
    color: POLICY_COLORS_BY_KEY.impact_threshold_freeze,
  },
  {
    key: "impact_unearned_income_tax",
    label: "Dividend, savings and property income tax increase",
    color: POLICY_COLORS_BY_KEY.impact_unearned_income_tax,
  },
  {
    key: "impact_salary_sacrifice_cap",
    label: "Salary sacrifice cap",
    color: POLICY_COLORS_BY_KEY.impact_salary_sacrifice_cap,
  },
  {
    key: "impact_sl_threshold_freeze",
    label: "Freeze student loan repayment thresholds",
    color: POLICY_COLORS_BY_KEY.impact_sl_threshold_freeze,
  },
  {
    key: "impact_two_child_limit",
    label: "2 child limit repeal",
    color: POLICY_COLORS_BY_KEY.impact_two_child_limit,
  },
  {
    key: "impact_fuel_duty_freeze",
    label: "Fuel duty freeze extension",
    color: POLICY_COLORS_BY_KEY.impact_fuel_duty_freeze,
  },
  {
    key: "impact_rail_fare_freeze",
    label: "Rail fares freeze",
    color: POLICY_COLORS_BY_KEY.impact_rail_fare_freeze,
  },
];

// Personal impact (household API) policy order: the candidate measures
export const PERSONAL_IMPACT_POLICY_ORDER = [
  "fuel_duty_rise_deferral",
  "state_pension_income_tax_protection",
  "warm_home_discount_top_up",
  "domestic_electricity_zero_vat",
  "employer_ni_relief_under_25s",
  "threshold_freeze_2031_32",
  "badr_lifetime_limit_cut",
  "salary_sacrifice_cap_2028",
  "road_fuel_vat_cut",
  "plan_2_threshold_unfreeze",
];

// Helper to get color by policy key
export function getPolicyColor(key) {
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || "#9CA3AF";
}

// Which lifecycle (Personal impact) series each population policy maps to.
// The lifecycle model still costs last year's measures by their old ids,
// none of which is a candidate measure, so every candidate selected is
// listed as not covered by the lifetime model until it is rebuilt.
// The lifecycle model costs the dividend, savings and property income tax
// increases as one series, so it needs all three.
export const LIFECYCLE_KEY_BY_POLICY = {
  two_child_limit: "impact_two_child_limit",
  fuel_duty_freeze: "impact_fuel_duty_freeze",
  rail_fares_freeze: "impact_rail_fare_freeze",
  threshold_freeze_extension: "impact_threshold_freeze",
  freeze_student_loan_thresholds: "impact_sl_threshold_freeze",
  salary_sacrifice_cap: "impact_salary_sacrifice_cap",
};
export const LIFECYCLE_COMBINED = {
  key: "impact_unearned_income_tax",
  policies: [
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
  ],
};

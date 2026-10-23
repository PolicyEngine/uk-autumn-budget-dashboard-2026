/**
 * Shared policy configuration for colors and labels across all charts.
 *
 * Color scheme:
 * - Teal/green spectrum: policies that are GOOD for households (costs to treasury)
 * - Amber/orange spectrum: policies that are BAD for households (revenue raisers)
 */

// Policy colors by display name (used in population impact charts)
// Includes all name variations used across different charts
// Colors ordered from darkest to lightest within each category for visual consistency
export const POLICY_COLORS = {
  // COSTS to treasury (good for households - teal/green spectrum, darkest to lightest)
  "2 child limit repeal": "#0D9488", // Teal 600 (darkest)
  "Fuel duty freeze extension": "#14B8A6", // Teal 500
  "Rail fares freeze": "#2DD4BF", // Teal 400
  "Zero-rate VAT on energy": "#5EEAD4", // Teal 300 (lightest)

  // REVENUE raisers (bad for households - amber/orange spectrum, darkest to lightest)
  "Threshold freeze extension": "#78350F", // Amber 900 (darkest)
  "Dividend tax increase (+2pp)": "#92400E", // Amber 800
  "Savings income tax increase (+2pp)": "#B45309", // Amber 700
  "Property income tax increase (+2pp)": "#D97706", // Amber 600
  "Salary sacrifice cap": "#F59E0B", // Amber 500
  "NICs on salary sacrifice (>£2k)": "#F59E0B", // Alternate name
  "Freeze student loan repayment thresholds": "#FBBF24", // Amber 400 (lightest)
};

// Policy colors by API key (used in lifecycle calculator and personal impact)
// Colors match POLICY_COLORS for consistency
export const POLICY_COLORS_BY_KEY = {
  // COSTS to treasury (good for households - teal/green spectrum, darkest to lightest)
  two_child_limit: "#0D9488", // Teal 600 (darkest)
  impact_two_child_limit: "#0D9488",
  fuel_duty_freeze: "#14B8A6", // Teal 500
  impact_fuel_duty_freeze: "#14B8A6",
  rail_fares_freeze: "#2DD4BF", // Teal 400
  impact_rail_fare_freeze: "#2DD4BF",

  // REVENUE raisers (bad for households - amber/orange spectrum, darkest to lightest)
  threshold_freeze_extension: "#78350F", // Amber 900 (darkest)
  impact_threshold_freeze: "#78350F",
  dividend_tax_increase_2pp: "#92400E", // Amber 800
  savings_tax_increase_2pp: "#B45309", // Amber 700
  property_tax_increase_2pp: "#D97706", // Amber 600
  impact_unearned_income_tax: "#B45309", // Combines dividend/savings/property
  salary_sacrifice_cap: "#F59E0B", // Amber 500
  impact_salary_sacrifice_cap: "#F59E0B",
  freeze_student_loan_thresholds: "#FBBF24", // Amber 400 (lightest)
  impact_sl_threshold_freeze: "#FBBF24",
};

// Order: revenue raisers first (positive for gov), then costs (negative for gov)
export const ALL_POLICY_NAMES = [
  // Revenue raisers (positive for gov)
  "Threshold freeze extension",
  "Dividend tax increase (+2pp)",
  "Savings income tax increase (+2pp)",
  "Property income tax increase (+2pp)",
  "Salary sacrifice cap",
  "Freeze student loan repayment thresholds",
  // Costs to treasury (negative for gov)
  "2 child limit repeal",
  "Fuel duty freeze extension",
  "Rail fares freeze",
  "Zero-rate VAT on energy",
];

// Measures that raise revenue (the rest of ALL_POLICY_NAMES cost revenue),
// for the legends' two groups
export const REVENUE_RAISING_NAMES = new Set([
  "Threshold freeze extension",
  "Dividend tax increase (+2pp)",
  "Savings income tax increase (+2pp)",
  "Property income tax increase (+2pp)",
  "Salary sacrifice cap",
  "Freeze student loan repayment thresholds",
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

// Personal impact policy order and colors
export const PERSONAL_IMPACT_POLICY_ORDER = [
  "two_child_limit",
  "fuel_duty_freeze",
  "rail_fares_freeze",
  "threshold_freeze_extension",
  "dividend_tax_increase_2pp",
  "savings_tax_increase_2pp",
  "property_tax_increase_2pp",
  "salary_sacrifice_cap",
];

// Helper to get color by policy key
export function getPolicyColor(key) {
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || "#9CA3AF";
}

// Which lifecycle (Personal impact) series each population policy maps to.
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

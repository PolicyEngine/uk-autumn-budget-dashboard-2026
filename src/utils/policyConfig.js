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
  "Employer NICs threshold £5,500 (MOCK)": "#0D9488",
  "Fuel duty 5p cut to August 2027 (MOCK)": "#14B8A6",
  "Universal Credit taper 50% (MOCK)": "#2DD4BF",
};

// Policy colors by API key (used in lifecycle calculator and personal impact)
// Colors match POLICY_COLORS for consistency
export const POLICY_COLORS_BY_KEY = {
  mock_employer_nics_threshold: "#0D9488",
  mock_fuel_duty_cut_extended: "#14B8A6",
  mock_uc_taper_50pc: "#2DD4BF",
};

// Order: revenue raisers first (positive for gov), then costs (negative for gov)
export const ALL_POLICY_NAMES = [
  "Employer NICs threshold £5,500 (MOCK)",
  "Fuel duty 5p cut to August 2027 (MOCK)",
  "Universal Credit taper 50% (MOCK)",
];

// Lifecycle calculator reform configuration
// Note: In lifecycle view, we show impact FROM HOUSEHOLD PERSPECTIVE
// (positive = good for household, negative = bad)
export const LIFECYCLE_REFORMS = [
  {
    key: "impact_rail_fare_freeze",
    label: "Rail fare freeze",
    color: POLICY_COLORS_BY_KEY.impact_rail_fare_freeze,
  },
  {
    key: "impact_fuel_duty_freeze",
    label: "Fuel duty freeze",
    color: POLICY_COLORS_BY_KEY.impact_fuel_duty_freeze,
  },
  {
    key: "impact_threshold_freeze",
    label: "Threshold freeze",
    color: POLICY_COLORS_BY_KEY.impact_threshold_freeze,
  },
  {
    key: "impact_unearned_income_tax",
    label: "Unearned income tax",
    color: POLICY_COLORS_BY_KEY.impact_unearned_income_tax,
  },
  {
    key: "impact_salary_sacrifice_cap",
    label: "Salary sacrifice cap",
    color: POLICY_COLORS_BY_KEY.impact_salary_sacrifice_cap,
  },
  {
    key: "impact_sl_threshold_freeze",
    label: "SL threshold freeze",
    color: POLICY_COLORS_BY_KEY.impact_sl_threshold_freeze,
  },
  {
    key: "impact_two_child_limit",
    label: "Two-child limit end",
    color: POLICY_COLORS_BY_KEY.impact_two_child_limit,
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

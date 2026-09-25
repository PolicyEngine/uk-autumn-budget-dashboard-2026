export const POLICIES = [
  { id: "cgt_equalisation", name: "CGT equalisation with income tax", color: "#B45309",
    description: "Align main capital gains tax rates with income tax",
    explanation: "Models main-schedule CGT rates of 20%, 40% and 45%, retaining the £3,000 allowance and allowing for reduced realisations. Residential property, carried interest and BADR changes are not included." },
  { id: "fuel_duty_rise_cancellation", name: "Cancel the fuel duty rise", color: "#0D9488",
    description: "Hold the model’s 2026 fuel duty rate",
    explanation: "Holds the bundled model’s 2026 rate of 53.45p per litre instead of its scheduled 59.25p rate in 2027 and later uprating. These are the model’s rates; this microsimulation is not benchmarked to HMRC fuel clearance totals." },
  { id: "bus_fare_cap", name: "£2 bus fare cap", color: "#2DD4BF",
    description: "Restore the £2 cap from £3",
    explanation: "Models a 12.5% reduction in bus and coach fare spending. Savings are included in household resources through bus subsidy spending. Later years assume the policy continues; funding beyond 2027 is uncertain." },
];

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
  ...Object.fromEntries(POLICIES.map((p) => [p.name, p.color])),
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
  ...Object.fromEntries(POLICIES.map((p) => [p.id, p.color])),
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
export const ALL_POLICY_NAMES = POLICIES.map((policy) => policy.name);

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
export const PERSONAL_IMPACT_POLICY_ORDER = POLICIES.map((policy) => policy.id);

// Helper to get color by policy key
export function getPolicyColor(key) {
  return POLICY_COLORS_BY_KEY[key] || POLICY_COLORS[key] || "#9CA3AF";
}

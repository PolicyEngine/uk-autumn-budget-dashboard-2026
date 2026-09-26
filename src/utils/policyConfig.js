export const POLICIES = [
  { id: "cgt_equalisation", name: "CGT equalisation with income tax", color: "#B45309",
    description: "Model income-tax-like rates on capital gains",
    explanation: "A simplified scenario using the pinned model's undifferentiated capital-gains input and a retention-rate elasticity of 1.0. Separate residential property and BADR schedules and carried-interest income tax/NIC treatment are not represented. This is not a full-schedule costing or a revenue floor." },
  { id: "fuel_duty_rise_cancellation", name: "Cancel the fuel duty rise", color: "#0D9488",
    description: "Hold petrol and diesel duty at 52.95p per litre from 2027",
    explanation: "Uses HMRC's amended 2026–27 schedule as the baseline: 52.95p/L through December 2026, 55.95p/L from January 2027, and 57.95p/L from March 2027. Later baseline years hold the March rate as an illustrative assumption. This microsimulation is not benchmarked to HMRC fuel clearance totals." },
  { id: "bus_fare_cap", name: "£2 bus fare cap", color: "#2DD4BF",
    description: "Restore the £2 cap outside London from 2027",
    explanation: "Models a 12.5% reduction in bus and coach spending for households in English regions outside London, using region as a proxy for participating services. The matching imputed subsidy is a service benefit in household resources, not cash income. Funding beyond 2027 is uncertain." },
  { id: "threshold_freeze_extension", name: "Threshold freeze extension", color: "#78350F",
    description: "Extend the freeze of income tax thresholds", explanation: "Compares frozen income tax thresholds with an indexed baseline from 2028." },
  { id: "dividend_tax_increase_2pp", name: "Dividend tax increase (+2pp)", color: "#92400E",
    description: "Increase dividend income tax by 2 percentage points", explanation: "Models the carried-over dividend income tax increase." },
  { id: "savings_tax_increase_2pp", name: "Savings income tax increase (+2pp)", color: "#B45309",
    description: "Increase savings income tax by 2 percentage points", explanation: "Models the carried-over savings income tax increase." },
  { id: "property_tax_increase_2pp", name: "Property income tax increase (+2pp)", color: "#D97706",
    description: "Increase property income tax by 2 percentage points", explanation: "Models the carried-over property income tax increase." },
];

// Retained only for old shared URLs; these do not appear in the 2026 selector.
export const LEGACY_POLICIES = [
  { id: "autumn_budget_2025_combined", name: "Autumn Budget 2025 (combined)", color: "#64748B" },
  { id: "two_child_limit", name: "2 child limit repeal", color: "#0D9488" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension", color: "#14B8A6" },
  { id: "rail_fares_freeze", name: "Rail fares freeze", color: "#2DD4BF" },
  { id: "freeze_student_loan_thresholds", name: "Freeze student loan repayment thresholds", color: "#FBBF24" },
  { id: "salary_sacrifice_cap", name: "Salary sacrifice cap", color: "#F59E0B" },
];
export const CHART_POLICIES = [...POLICIES, ...LEGACY_POLICIES];

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
  ...Object.fromEntries(CHART_POLICIES.map((p) => [p.name, p.color])),
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
  ...Object.fromEntries(CHART_POLICIES.map((p) => [p.id, p.color])),
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
export const ALL_POLICY_NAMES = CHART_POLICIES.map((policy) => policy.name);

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

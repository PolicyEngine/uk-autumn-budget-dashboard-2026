// MOCK drill 3: measures from the 12:30 statement (MOCK-statement.md). Invented for a rehearsal.
export const POLICIES = [
  { id: "mock3_fuel_duty_phasing", name: "Fuel duty rises phased", color: "#0D9488",
    description: "MOCK: 52.95p per litre to March 2027, 55.95p from April, 57.95p from October 2027",
    explanation: "MOCK basis: costings and Annex A. The January and March 2027 rises do not happen: 52.95p per litre to 31 March 2027, 55.95p from 1 April and 57.95p from 1 October 2027, then RPI uprating from April 2028. Baseline is Annex A (59.92p from April 2027, then RPI). Includes 20% VAT on the duty change; calendar years in the charts. The model covers household fuel only, about half the 43 billion litre base." },
  { id: "mock3_whd_top_up", name: "Warm Home Discount top-up", color: "#14B8A6",
    description: "MOCK: an extra £100 for Warm Home Discount households in England and Wales, two winters",
    explanation: "MOCK basis: costings and Annex A. An extra £100 in winter 2026-27 and winter 2027-28 for households in England and Wales that get the Warm Home Discount. The model has no Warm Home Discount, so eligibility is approximated from receipt of Universal Credit, Housing Benefit, income-related ESA, income-based JSA or Pension Credit." },
  { id: "mock3_lha_30th_percentile", name: "Local Housing Allowance at the 30th percentile", color: "#2DD4BF",
    description: "MOCK: LHA rates in Great Britain back to the 30th percentile of rents from April 2027",
    explanation: "MOCK basis: costings and Annex A. Local Housing Allowance rates return to the 30th percentile of local rents from April 2027 and are kept there each year, for private renters on Housing Benefit or Universal Credit in Great Britain." },
  { id: "mock3_pensioner_allowance", name: "Pensioner Allowance", color: "#5EEAD4",
    description: "MOCK: an allowance equal to the State Pension where above the Personal Allowance, from April 2027",
    explanation: "MOCK basis: costings and Annex A. From April 2027 people over State Pension age get an allowance equal to their State Pension where that is higher than the Personal Allowance, withdrawn above £30,000 of adjusted net income. Rounded up to the next £10 and withdrawn by £1 for every £2; State Pension at the Annex A rates." },
  { id: "mock3_employer_ni_under_22", name: "Employer NI relief for under-22s", color: "#99F6E4",
    description: "MOCK: no employer National Insurance on earnings of employees aged 21, up to the upper limit, from April 2027",
    explanation: "MOCK basis: costings and Annex A. Extends the employer National Insurance relief to employees aged under 22 from April 2027, up to the upper earnings limit. The model has no under-21 relief, so only employees aged 21 are affected. The figure is gross employer National Insurance; with fixed earnings households see no change." },
  { id: "mock3_additional_rate_threshold", name: "Additional rate threshold £100,000", color: "#78350F",
    description: "MOCK: the 45p rate starts at £100,000 instead of £125,140 from April 2027",
    explanation: "MOCK basis: costings and Annex A. From April 2027 the higher rate limit falls from £125,140 to £100,000 of taxable income, so the 45p rate starts there (savings and dividends UK-wide; other income outside Scotland)." },
  { id: "mock3_cgt_higher_rate_aea", name: "Capital Gains Tax: 28% higher rate, £2,000 exemption", color: "#92400E",
    description: "MOCK: CGT higher rate 24% to 28% and annual exempt amount £3,000 to £2,000 from 6 April 2027",
    explanation: "MOCK basis: costings and Annex A. From 6 April 2027 the higher and additional rates of Capital Gains Tax rise from 24% to 28%, including residential property, and the annual exempt amount falls from £3,000 to £2,000. Static: no change in realisations." },
  { id: "mock3_salary_sacrifice_cap", name: "Salary sacrifice NI limit £1,000", color: "#B45309",
    description: "MOCK: the NI-exempt pension salary-sacrifice limit falls from £2,000 to £1,000 from April 2029",
    explanation: "MOCK basis: costings and Annex A. From 6 April 2029 pension salary sacrifice above £1,000 a year (down from £2,000) pays employee and employer National Insurance. Income tax relief on pension contributions continues." },
  { id: "mock3_hvcts_top_bands", name: "Council tax surcharge: £5m and £10m bands", color: "#D97706",
    description: "MOCK: £10,000 for English homes worth £5m to £10m and £15,000 from £10m, from April 2028",
    explanation: "MOCK basis: costings and Annex A. From April 2028 owners of homes in England worth £5 million to £10 million (2026 values) pay a £10,000 High Value Council Tax Surcharge and homes worth £10 million or more pay £15,000, uprated with CPI. Static." },
  { id: "mock3_threshold_freeze_2032", name: "Thresholds frozen to April 2032", color: "#F59E0B",
    description: "MOCK: Personal Allowance, higher rate threshold and main NI thresholds frozen for 2031-32",
    explanation: "MOCK basis: costings and Annex A. The Personal Allowance, the higher rate threshold and the main National Insurance thresholds stay at their 2030-31 levels for one more year, to April 2032." },
  { id: "mock3_class4_main_rate", name: "Class 4 NI main rate 7%", color: "#FBBF24",
    description: "MOCK: the self-employed Class 4 main rate rises from 6% to 7% from April 2027",
    explanation: "MOCK basis: costings and Annex A. From April 2027 the Class 4 National Insurance main rate on self-employed profits between the lower and upper profits limits rises from 6% to 7%." },
];

// Retained only for old shared URLs; these do not appear in the 2026 selector.
export const LEGACY_POLICIES = [
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

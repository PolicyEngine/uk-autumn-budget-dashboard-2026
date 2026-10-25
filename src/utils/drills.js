/**
 * The page's scenarios: Current (today's candidate measures, the default)
 * and the four past mock-Budget drills. A drill is a rehearsal with mock
 * measures, not real policy.
 *
 * A drill's results are its drill-day national tables (revenue, and change
 * by income decile), copied under public/data/drills/drillN/ from the data
 * commit on its branch; the review rows in data_inputs/public_data_review.csv
 * name each commit. `outputs` lists the sections a drill has; every other
 * section shows "Not calculated in this drill."
 *
 * Measure names and summaries are the drills' own (the drill reruns
 * comparison, docs/drill-reruns/2026-10-24 on drill-rerun-latest-engine).
 * `raises` says whether a measure raises revenue over the drill's years.
 */

export const CURRENT_SCENARIO = "current";

/** The query parameter that holds the scenario (?scenario=). */
export const SCENARIO_PARAM = "scenario";

/** Sections a drill can have; Current has them all. */
export const OUTPUTS = {
  revenue: "revenue",
  deciles: "deciles",
  map: "map",
  scatter: "scatter",
  examples: "examples",
  young: "young",
};

const measure = (id, name, summary, starts, type, icon, raises = false) => ({
  id,
  name,
  description: summary,
  summary,
  starts,
  type,
  icon,
  raises,
});

export const DRILLS = [
  {
    id: "drill1",
    label: "Drill 1",
    date: "28 September 2026",
    outputs: [OUTPUTS.revenue, OUTPUTS.deciles],
    measures: [
      measure("mock_hvcts_extension", "Council tax surcharge from £1.5m", "High Value Council Tax Surcharge extended to homes in England worth £1.5 million or more from 1 April 2028.", "April 2028", "Council tax", "house", true),
      measure("mock_fuel_duty_freeze", "Fuel duty freeze", "Cancels the 1 March 2027 2p rise and the April 2027 inflation rise; main rates held at 55.95p a litre to 31 March 2028.", "March 2027", "Fuel duty", "fuel"),
      measure("mock_energy_vat_zero_rate", "VAT zero rate on household energy", "Zero rate of VAT on domestic electricity and gas in Great Britain, 1 April 2027 to 31 March 2028.", "April 2027", "VAT", "tag"),
      measure("mock_child_benefit_increase", "Child Benefit increase", "Child Benefit to £30.00 a week for the eldest child and £20.00 for each other child from April 2027.", "April 2027", "Benefit", "users"),
      measure("mock_nics_threshold_rise", "National Insurance threshold rise", "Primary Threshold and Lower Profits Limit from £12,570 to £13,000 from 6 April 2027, held until April 2031.", "April 2027", "National Insurance", "building"),
    ],
  },
  {
    id: "drill2",
    label: "Drill 2",
    date: "5 October 2026",
    outputs: [OUTPUTS.revenue, OUTPUTS.deciles],
    measures: [
      measure("mock2_cgt_rates", "Capital Gains Tax rate rise", "Capital Gains Tax rates rise from 18% to 20% and from 24% to 28% from 6 April 2027, including residential property.", "April 2027", "Capital gains tax", "briefcase", true),
      measure("mock2_hvcts_band", "Council tax surcharge band from £1.5m", "New £1,500 High Value Council Tax Surcharge band for homes in England worth £1.5 million to £2 million from April 2028.", "April 2028", "Council tax", "house", true),
      measure("mock2_state_pension_uprating", "State Pension uprating: higher of CPI and 2.5%", "From April 2030 the State Pension rises by the higher of CPI and 2.5%; average earnings leave the triple lock.", "April 2030", "State Pension", "clock", true),
      measure("mock2_fuel_duty_hold", "Fuel duty held until September 2027", "The 3p (1 January 2027) and 2p (1 March 2027) rises do not go ahead; 52.95p a litre to 31 August 2027, then 55.95p.", "January 2027", "Fuel duty", "fuel"),
      measure("mock2_electricity_vat_zero", "No VAT on household electricity to March 2028", "Zero VAT on domestic electricity in Great Britain continues from 1 April 2027 to 31 March 2028; gas stays at 5%.", "April 2027", "VAT", "tag"),
      measure("mock2_employer_ni_threshold", "Employer National Insurance threshold rise", "Employer NI Secondary Threshold from £5,000 to £5,500 a year from April 2027, held flat to 2030-31.", "April 2027", "National Insurance", "building"),
      measure("mock2_state_pension_personal_allowance", "State Pension personal allowance", "£13,100 personal allowance at State Pension age from April 2027, withdrawn at £1 per £2 of income above £20,000.", "April 2027", "Income tax", "clock"),
      measure("mock2_energy_price_payment", "Energy Price Protection Payment", "One-off £150 per household in Great Britain on Universal Credit or Pension Credit guarantee credit, paid January 2027.", "January 2027", "Benefit", "flame"),
    ],
  },
  {
    id: "drill3",
    label: "Drill 3",
    date: "12 October 2026",
    outputs: [OUTPUTS.revenue, OUTPUTS.deciles],
    measures: [
      measure("mock3_cgt_higher_rate_aea", "Capital Gains Tax higher rate and annual exempt amount", "Capital Gains Tax higher rate from 24% to 28% and annual exempt amount from £3,000 to £2,000, from 6 April 2027.", "April 2027", "Capital gains tax", "briefcase", true),
      measure("mock3_additional_rate_threshold", "Lower additional rate threshold", "The 45p additional rate starts at £100,000 of taxable income instead of £125,140 from April 2027.", "April 2027", "Income tax", "receipt", true),
      measure("mock3_threshold_freeze_2032", "Threshold freeze extended to April 2032", "Personal Allowance (£12,570), basic rate limit (£37,700), NI Primary Threshold, UEL and Class 4 limits stay at 2030-31 levels in 2031-32.", "April 2031", "Income tax", "receipt", true),
      measure("mock3_salary_sacrifice_cap", "Lower pension salary sacrifice limit", "Pension salary sacrifice exempt from National Insurance falls from £2,000 to £1,000 a year from 6 April 2029.", "April 2029", "National Insurance", "piggy", true),
      measure("mock3_class4_main_rate", "Class 4 National Insurance main rate rise", "Class 4 National Insurance main rate for the self-employed rises from 6% to 7% from April 2027.", "April 2027", "National Insurance", "building", true),
      measure("mock3_hvcts_top_bands", "Council tax surcharge top bands", "High Value Council Tax Surcharge of £10,000 for homes in England worth £5 million to £10 million and £15,000 above, from April 2028.", "April 2028", "Council tax", "house", true),
      measure("mock3_pensioner_allowance", "Pensioner Allowance", "Allowance equal to the State Pension where above the Personal Allowance, from April 2027, withdrawn above £30,000 of income.", "April 2027", "Income tax", "clock"),
      measure("mock3_employer_ni_under_22", "Employer National Insurance relief for under-22s", "No employer National Insurance on earnings of employees aged under 22, up to the upper earnings limit, from April 2027.", "April 2027", "National Insurance", "building"),
      measure("mock3_lha_30th_percentile", "Local Housing Allowance restored to 30th percentile", "Local Housing Allowance rates in Great Britain return to the 30th percentile of local rents from April 2027.", "April 2027", "Benefit", "key"),
      measure("mock3_fuel_duty_phasing", "Fuel duty rises phased", "The January and March 2027 rises are deferred: 52.95p a litre to 31 March 2027, 55.95p from 1 April, 57.95p from 1 October 2027.", "January 2027", "Fuel duty", "fuel"),
      measure("mock3_whd_top_up", "Warm Home Discount £100 top-up", "Extra £100 per Warm Home Discount household in England and Wales in winters 2026-27 and 2027-28.", "Winter 2026-27", "Benefit", "flame"),
    ],
  },
  {
    id: "drill4",
    label: "Drill 4",
    date: "19 October 2026",
    outputs: [OUTPUTS.revenue, OUTPUTS.deciles, OUTPUTS.map],
    measures: [
      measure("mock4_cgt_higher_rate", "CGT higher rate 26%", "Capital Gains Tax higher rate from 24% to 26% from 6 April 2027, including residential property.", "April 2027", "Capital gains tax", "briefcase", true),
      measure("mock4_threshold_freeze_2032", "Thresholds frozen to April 2032", "Personal Allowance, basic rate limit, NI thresholds and Class 4 limits held at 2030-31 levels for 2031-32.", "April 2031", "Income tax", "receipt", true),
      measure("mock4_savings_starting_band", "Savings starting-rate band £2,000", "Starting rate band for savings cut from £5,000 to £2,000 from April 2028.", "April 2028", "Income tax", "piggy", true),
      measure("mock4_employer_ni_under23", "Employer NI relief for under-23s", "No employer Class 1 National Insurance on earnings up to £25,000 a year for employees under 23, from April 2027.", "April 2027", "National Insurance", "building"),
      measure("mock4_lha_reset", "LHA reset to 30th percentile", "Local Housing Allowance rates in Great Britain reset to the 30th percentile in April 2027, then frozen.", "April 2027", "Benefit", "key"),
      measure("mock4_uc_child_element", "UC child element +£12.50 a month", "Universal Credit child element up £12.50 a month per child from April 2027.", "April 2027", "Benefit", "users"),
      measure("mock4_fuel_duty", "Fuel duty rises cancelled and restaged", "Fuel duty stays at 52.95p to 22 February 2027, 54.95p from 23 February 2027 and 56.95p from 1 October 2027.", "January 2027", "Fuel duty", "fuel"),
      measure("mock4_state_pension_topup_allowance", "State Pension Top-up Allowance", "Income tax allowance for State Pension recipients equal to the amount their State Pension exceeds their personal allowance, from April 2027.", "April 2027", "Income tax", "clock"),
      measure("mock4_cb_early_years_addition", "Child Benefit Early Years Addition", "Child Benefit Early Years Addition of £10 a week for each child under 1 from April 2027.", "April 2027", "Benefit", "users"),
      measure("mock4_whd_topup", "Warm Home Discount top-up", "Winter 2026-27 only: a further £125 for Warm Home Discount households on means-tested benefits and £75 for Pension Credit households, England and Wales.", "Winter 2026-27", "Benefit", "flame"),
      measure("mock4_fuel_vat_cut", "VAT cut on road fuel", "VAT on petrol and diesel falls from 20% to 15% from 1 December 2026 to 31 May 2027.", "December 2026", "VAT", "tag"),
      measure("mock4_carers_allowance_limit", "Carer's Allowance earnings limit £230", "Carer's Allowance earnings limit from £204 to £230 a week from April 2027.", "April 2027", "Benefit", "user"),
    ],
  },
];

export const DRILL_BY_ID = Object.fromEntries(DRILLS.map((drill) => [drill.id, drill]));

/** The scenario pill's options: Current first. */
export const SCENARIO_OPTIONS = [
  { value: CURRENT_SCENARIO, label: "Current" },
  ...DRILLS.map((drill) => ({ value: drill.id, label: drill.label })),
];

/** The scenario a page address opens (?scenario=), else Current. */
export function scenarioFromSearch(search) {
  const value = new URLSearchParams(search).get(SCENARIO_PARAM);
  return DRILL_BY_ID[value] ? value : CURRENT_SCENARIO;
}

/** Where a scenario's data files are, under the base path. */
export function scenarioDataPath(scenario) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${scenarioDataDir(scenario)}`;
}

/** A scenario's data folder under the base path, for the map's loader. */
export function scenarioDataDir(scenario) {
  return DRILL_BY_ID[scenario] ? `/data/drills/${scenario}` : "/data";
}

/** Whether a scenario has a section: Current has every one. */
export function scenarioHas(scenario, output) {
  const drill = DRILL_BY_ID[scenario];
  return drill ? drill.outputs.includes(output) : true;
}

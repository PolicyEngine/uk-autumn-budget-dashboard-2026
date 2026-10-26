/**
 * Household requests to compare, for the request-identity test
 * (src/utils/householdRequestIdentity.test.js): the form's answers, a year,
 * the measures and the stage, and nothing else. The bytes each one gave
 * before the household model moved to policyengine-household-wizard are in
 * src/test/fixtures/householdRequests.golden.json.
 *
 * Two kinds:
 * - curated: every example household and the form's defaults, for each
 *   year and stage the page asks with, and hand-picked answers at the
 *   edges of each rule (a partner's answers kept while there is none, the
 *   education question from 16, a child of 20, rent and childcare only
 *   where they count, the State Pension only at State Pension age);
 * - sampled: answers drawn from a seeded generator, wider than the form
 *   allows (child ages to 22, text the age parser drops, unknown regions
 *   and tenures, entered and prefilled amounts). JSON-safe only, so the
 *   answers and their request survive the golden file.
 *
 * Changing anything here changes the cases, and the golden file then no
 * longer matches them: it is a record of the code before the move, and is
 * never regenerated from the code after it.
 */
import { HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";

// The years the page asks with: 0 (comparing answers without a year), the
// display years, and one either side
export const CASE_YEARS = [0, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032];
export const CASE_POLICIES = [[], ["road_fuel_vat_cut"], ["income_tax_threshold_freeze", "road_fuel_vat_cut", "two_child_limit"]];
export const CASE_INCLUDES = [[], ["sweep"], ["by_policy"], ["by_policy", "sweep"]];

const REGIONS = [
  "NORTH_EAST",
  "NORTH_WEST",
  "YORKSHIRE",
  "EAST_MIDLANDS",
  "WEST_MIDLANDS",
  "EAST_OF_ENGLAND",
  "LONDON",
  "SOUTH_EAST",
  "SOUTH_WEST",
  "WALES",
  "SCOTLAND",
  "NORTHERN_IRELAND",
];
const TENURES = ["RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA", "OWNED_WITH_MORTGAGE", "OWNED_OUTRIGHT"];
const PLANS = ["NONE", "PLAN_1", "PLAN_2", "PLAN_4", "PLAN_5", "POSTGRADUATE"];
const BANDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

/**
 * The curated cases over `defaults` (the form's starting answers): each
 * example and the defaults alone for every year, measure list and stage,
 * then the edge cases for one year and measure list each.
 */
export function curatedCases(defaults) {
  const households = [
    { name: "defaults", inputs: { ...defaults } },
    ...HOUSEHOLD_EXAMPLES.map((example) => ({ name: `example:${example.id}`, inputs: { ...defaults, ...example.inputs } })),
  ];
  const cases = [];
  for (const { name, inputs } of households) {
    for (const year of CASE_YEARS) {
      for (const policies of CASE_POLICIES) {
        for (const include of CASE_INCLUDES) {
          cases.push({ name, inputs, year, policies, include });
        }
      }
    }
  }
  const edge = (name, changes, year = 2027) => ({
    name: `edge:${name}`,
    inputs: { ...defaults, ...changes },
    year,
    policies: ["road_fuel_vat_cut"],
    include: [],
  });
  cases.push(
    edge("partner off, answers kept", { has_partner: false, partner_age: 52, partner_salary: 61000, partner_private_pension_per_year: 4000, partner_state_pension_per_year: 9000 }),
    edge("partner on", { has_partner: true, partner_age: 52, partner_salary: 61000, partner_private_pension_per_year: 4000 }),
    edge("partner at State Pension age, prefilled", { has_partner: true, partner_age: 70 }),
    edge("partner at State Pension age, entered", { has_partner: true, partner_age: 70, partner_state_pension_per_year: 9100.5 }),
    edge("partner under State Pension age, entered", { has_partner: true, partner_age: 60, partner_state_pension_per_year: 9100 }),
    edge("you at State Pension age, entered", { current_age: 67, state_pension_per_year: 11000 }),
    edge("you at 66 in 2026", { current_age: 66, state_pension_per_year: 11000 }, 2026),
    edge("you at 66 in 2027", { current_age: 66, state_pension_per_year: 11000 }, 2027),
    edge("State Pension 0", { current_age: 75, state_pension_per_year: 0 }),
    edge("children with education", { children_ages: "17, 16, 19, 4", children_in_education: [false, true] }),
    edge("child of 20", { children_ages: "20, 3", children_in_education: [] }),
    edge("children text the parser trims", { children_ages: " 5,,x, 3.7, -1, 18 ", children_in_education: [true, false, false] }),
    edge("children and childcare", { children_ages: "2", monthly_childcare: 640 }),
    edge("childcare without children", { children_ages: "", monthly_childcare: 640 }),
    edge("renting from the council, rent entered", { tenure: "RENT_FROM_COUNCIL", monthly_rent: 512.25 }),
    edge("housing association, prefilled rent", { tenure: "RENT_FROM_HA", monthly_rent: null, region: "LONDON" }),
    edge("owner with rent left in", { tenure: "OWNED_OUTRIGHT", monthly_rent: 900 }),
    edge("unknown region", { region: "ATLANTIS", monthly_rent: null }),
    edge("Northern Ireland", { region: "NORTHERN_IRELAND", council_tax_band: "D" }),
    edge("electricity left out", { electricity_spending_per_year: null }),
    edge("private pension left out", { private_pension_per_year: null, partner_private_pension_per_year: null, has_partner: true }),
    edge("Universal Credit off", { claims_universal_credit: false }),
    edge("everything at once", {
      current_age: 58,
      current_salary: 123456.78,
      region: "SCOTLAND",
      tenure: "RENT_PRIVATELY",
      monthly_rent: 1500,
      student_loan_plan: "PLAN_4",
      has_partner: true,
      partner_age: 69,
      partner_salary: 0,
      children_ages: "16, 12",
      children_in_education: [false],
      claims_universal_credit: false,
      council_tax_band: "G",
      salary_sacrifice_per_year: 8000,
      petrol_spending_per_year: 0,
      diesel_spending_per_year: 1800,
      electricity_spending_per_year: 2100,
      dividends_per_year: 3000,
      savings_interest_per_year: 400,
      property_income_per_year: 12000,
      private_pension_per_year: 0,
      partner_private_pension_per_year: 15000,
      monthly_childcare: 300,
      state_pension_per_year: null,
      partner_state_pension_per_year: 12000,
    }),
  );
  return cases;
}

/** mulberry32: a small seeded generator, so the sampled cases are fixed. */
function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_SEED = 20261025;
export const SAMPLE_COUNT = 400;

/** `count` sampled cases from `seed`, each answer drawn on its own. */
export function sampledCases(seed = SAMPLE_SEED, count = SAMPLE_COUNT) {
  const random = generator(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  // An amount: often 0, sometimes pennies
  const amount = (max) => {
    const r = random();
    if (r < 0.25) return 0;
    if (r < 0.4) return Math.round(random() * max * 100) / 100;
    return Math.round(random() * max);
  };
  const maybeNull = (value, p = 0.3) => (random() < p ? null : value);
  const childrenText = () => {
    const n = int(0, 5);
    const ages = Array.from({ length: n }, () => (random() < 0.08 ? pick(["", "x", "3.7", "-1", " 7 "]) : String(int(0, 22))));
    return ages.join(pick([", ", ",", " , "]));
  };
  const cases = [];
  for (let i = 0; i < count; i += 1) {
    const inputs = {
      current_age: int(16, 100),
      current_salary: amount(500000),
      region: random() < 0.05 ? "ATLANTIS" : pick(REGIONS),
      tenure: random() < 0.03 ? "HOUSEBOAT" : pick(TENURES),
      monthly_rent: maybeNull(amount(10000), 0.4),
      student_loan_plan: pick(PLANS),
      has_partner: random() < 0.5,
      partner_age: int(16, 100),
      partner_salary: amount(500000),
      children_ages: childrenText(),
      children_in_education: Array.from({ length: int(0, 6) }, () => pick([true, false, false, null, "no"])),
      claims_universal_credit: random() < 0.6,
      council_tax_band: pick(BANDS),
      salary_sacrifice_per_year: amount(60000),
      petrol_spending_per_year: amount(20000),
      diesel_spending_per_year: amount(20000),
      electricity_spending_per_year: maybeNull(amount(20000), 0.15),
      dividends_per_year: amount(100000),
      savings_interest_per_year: amount(100000),
      property_income_per_year: amount(100000),
      private_pension_per_year: maybeNull(amount(200000), 0.15),
      partner_private_pension_per_year: maybeNull(amount(200000), 0.15),
      monthly_childcare: amount(5000),
      state_pension_per_year: maybeNull(amount(25000), 0.5),
      partner_state_pension_per_year: maybeNull(amount(25000), 0.5),
    };
    cases.push({
      name: `sample:${i}`,
      inputs,
      year: pick(CASE_YEARS),
      policies: pick(CASE_POLICIES),
      include: pick(CASE_INCLUDES),
    });
  }
  return cases;
}

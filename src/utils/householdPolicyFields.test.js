import { describe, expect, it } from "vitest";
import { POLICY_FIELDS, policyQuestions } from "./householdPolicyFields";

const ENERGY = "household_energy_payment_2026";

describe("the questions the selected policies read", () => {
  it("asks the Council Tax band for the energy payment in England only", () => {
    const ask = (region) => policyQuestions([ENERGY], { inputs: { region }, year: 2026 }).map((q) => q.id);
    expect(ask("NORTH_WEST")).toEqual(["council_tax_band"]);
    for (const region of ["SCOTLAND", "WALES", "NORTHERN_IRELAND"]) expect(ask(region)).toEqual([]);
  });

  it("asks bus fares for the bus fare cap in England outside London, in 2026-27 and 2027-28", () => {
    const ask = (region, year) => policyQuestions(["bus_fare_cap_2027"], { inputs: { region }, year }).map((q) => q.id);
    expect(ask("NORTH_WEST", 2026)).toEqual(["bus_fare_spending_per_year"]);
    expect(ask("SOUTH_EAST", 2027)).toEqual(["bus_fare_spending_per_year"]);
    expect(ask("NORTH_WEST", 2028)).toEqual([]);
    for (const region of ["LONDON", "SCOTLAND", "WALES", "NORTHERN_IRELAND"]) expect(ask(region, 2027)).toEqual([]);
  });

  it("asks property income for the property rates and savings interest for the savings rates, not dividends", () => {
    const ask = (ids) => policyQuestions(ids, { inputs: {}, year: 2027 }).map((q) => q.id);
    expect(ask(["property_income_rates_up"])).toEqual(["property_income_per_year"]);
    expect(ask(["savings_income_rates_up"])).toEqual(["savings_interest_per_year"]);
    expect(ask(["property_income_rates_up", "savings_income_rates_up"])).toEqual(["property_income_per_year", "savings_interest_per_year"]);
  });

  it("has no rows for the measures the Budget left out", () => {
    for (const id of ["warm_home_discount_top_up", "plan_2_threshold_unfreeze", "threshold_freeze_2031_32", "employer_nics_secondary_threshold_raise"]) {
      expect(POLICY_FIELDS[id], id).toBeUndefined();
    }
  });
});

import { describe, expect, it } from "vitest";
import { POLICY_FIELDS, policyQuestions } from "./householdPolicyFields";

const ENERGY = "household_energy_payment_2026";

describe("the questions the selected policies read", () => {
  it("asks the Council Tax band for the energy payment in England only", () => {
    const ask = (region) => policyQuestions([ENERGY], { inputs: { region }, year: 2026 }).map((q) => q.id);
    expect(ask("NORTH_WEST")).toEqual(["council_tax_band"]);
    for (const region of ["SCOTLAND", "WALES", "NORTHERN_IRELAND"]) expect(ask(region)).toEqual([]);
  });

  it("asks savings and property income, not dividends, for the savings and property rates", () => {
    const ids = policyQuestions(["unearned_income_rates_up"], { inputs: {}, year: 2027 }).map((q) => q.id);
    expect(ids).toEqual(["savings_interest_per_year", "property_income_per_year"]);
  });

  it("asks whether they care for someone for the Carer's Allowance taper", () => {
    const ids = policyQuestions(["carers_allowance_earnings_taper"], { inputs: {}, year: 2030 }).map((q) => q.id);
    expect(ids).toEqual(["cares_for_someone"]);
  });

  it("has no rows for the measures the Budget left out", () => {
    for (const id of ["warm_home_discount_top_up", "plan_2_threshold_unfreeze", "threshold_freeze_2031_32", "employer_nics_secondary_threshold_raise"]) {
      expect(POLICY_FIELDS[id], id).toBeUndefined();
    }
  });
});

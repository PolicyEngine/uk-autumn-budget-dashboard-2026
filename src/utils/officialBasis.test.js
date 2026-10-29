import { describe, expect, it } from "vitest";
import contract from "./publication/contract.json";
import { BASIS_LABEL, GENERIC_BASIS, VARIABLE_WORDS, basisLabel, basisWords } from "./officialBasis";

describe("what ours on the official costing's basis counts", () => {
  it("names each measure's ring by the variables the generator sums", () => {
    expect(basisLabel("carers_allowance_earnings_taper")).toBe("Ours, Carer's Allowance and Universal Credit only");
    expect(basisLabel("state_pension_income_tax_protection")).toBe("Ours, income tax only");
  });

  it("has words for every variable the contract names", () => {
    const variables = Object.values(contract.official_bases).flat();
    expect(variables.length).toBeGreaterThan(0);
    expect(variables.filter((name) => !Object.hasOwn(VARIABLE_WORDS, name))).toEqual([]);
  });

  it("falls back to the label that serves every row, never to 'the official costing's basis'", () => {
    expect(basisWords("fuel_duty_rise_deferral")).toBe(GENERIC_BASIS);
    expect(basisWords("m", { m: ["national_insurance"] })).toBe(GENERIC_BASIS);
    expect(basisWords("constructor")).toBe(GENERIC_BASIS);
    expect(BASIS_LABEL).toBe("Ours, the official costing's taxes and benefits only");
    expect(BASIS_LABEL).not.toMatch(/official costing's basis/);
  });

  it("joins three or more in a list", () => {
    expect(basisWords("m", { m: ["income_tax", "carers_allowance", "universal_credit"] })).toBe("income tax, Carer's Allowance and Universal Credit");
  });
});

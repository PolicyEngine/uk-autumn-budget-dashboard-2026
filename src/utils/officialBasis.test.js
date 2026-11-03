import { describe, expect, it } from "vitest";
import contract from "./publication/contract.json";
import { BASIS_LABEL, GENERIC_BASIS, VARIABLE_WORDS, basisLabel, basisVariables, basisWords } from "./officialBasis";

describe("what ours on the official costing's basis counts", () => {
  it("names a ring by the variables its table row says it sums", () => {
    expect(basisLabel(basisVariables("carers_allowance;universal_credit"))).toBe("Ours, Carer's Allowance and Universal Credit only");
    expect(basisLabel("income_tax")).toBe("Ours, income tax only");
  });

  it("has words for every variable the generator can sum", () => {
    expect(contract.official_basis_variables.length).toBeGreaterThan(0);
    expect(contract.official_basis_variables.filter((name) => !Object.hasOwn(VARIABLE_WORDS, name))).toEqual([]);
  });

  it("falls back to the label that serves every row, never to 'the official costing's basis'", () => {
    expect(basisWords([])).toBe(GENERIC_BASIS);
    expect(basisWords(undefined)).toBe(GENERIC_BASIS);
    expect(basisWords(["national_insurance"])).toBe(GENERIC_BASIS);
    expect(basisWords(["constructor"])).toBe(GENERIC_BASIS);
    expect(BASIS_LABEL).toBe("Ours, the official costing's taxes and benefits only");
    expect(BASIS_LABEL).not.toMatch(/official costing's basis/);
  });

  it("joins three or more in a list, in the table's order", () => {
    expect(basisWords("income_tax;carers_allowance;universal_credit")).toBe("income tax, Carer's Allowance and Universal Credit");
    expect(basisVariables(" income_tax ; ;universal_credit")).toEqual(["income_tax", "universal_credit"]);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CALCULATOR_ONLY_MEASURES,
  GAS_STANDING_CHARGES_ID,
  SAVINGS_INCOME_RATES_ID,
  isCalculatorOnly,
  resultPolicies,
  withCalculatorOnly,
  withoutCalculatorOnly,
} from "./calculatorOnlyMeasures";
import { policyRows } from "./singleYear";
import { UNMODELLED_MEASURES } from "./unmodelledMeasures";

describe("calculator-only measures", () => {
  it("always go after the selected measures, once, and come off for the national figures", () => {
    expect(withCalculatorOnly(["a", "b"])).toEqual(["a", "b", SAVINGS_INCOME_RATES_ID, GAS_STANDING_CHARGES_ID]);
    expect(withCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID])).toEqual(["a", SAVINGS_INCOME_RATES_ID, GAS_STANDING_CHARGES_ID]);
    // Nothing selected: no request, so nothing added
    expect(withCalculatorOnly([])).toEqual([]);
    expect(withoutCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID, GAS_STANDING_CHARGES_ID])).toEqual(["a"]);
  });

  it("include gas standing charges abolished, named, with its Policies card", () => {
    // The household API's own id for it (gas_standing_charges.py)
    expect(GAS_STANDING_CHARGES_ID).toBe("gas_standing_charges_abolition");
    expect(CALCULATOR_ONLY_MEASURES[GAS_STANDING_CHARGES_ID]).toEqual({
      id: GAS_STANDING_CHARGES_ID,
      name: "Gas standing charges abolished",
      phrase: "the gas standing charge abolition",
      card: "gas-standing-charges",
    });
    expect(UNMODELLED_MEASURES.map((card) => card.id)).toContain(CALCULATOR_ONLY_MEASURES[GAS_STANDING_CHARGES_ID].card);
  });

  it("show in the split by policy with their short name, and no note", () => {
    const byPolicy = {
      measures: [
        { id: "property_income_rates_up", name: "Property income tax rates up", change: 0, status: "not_affected" },
        { id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax rates up", change: -190, status: "affected" },
      ],
      residual: 0,
    };
    const bars = policyRows(byPolicy, -190, [{ id: "property_income_rates_up", name: "Property income tax up" }], 2027);
    expect(bars.rows).toEqual([expect.objectContaining({ id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax up", rounded: -190 })]);
    expect(bars.notes).toEqual([]);
  });
});

describe("the result card's measures (resultPolicies)", () => {
  const CALCULATOR_ONLY_IDS = Object.keys(CALCULATOR_ONLY_MEASURES);
  // Header selections: distinct catalogue-like ids, never a calculator-only one
  const selection = fc.uniqueArray(
    fc.stringMatching(/^[a-z][a-z_]{0,20}$/).filter((id) => !isCalculatorOnly(id)),
    { minLength: 1, maxLength: 12 },
  );

  it("counts the selection and names each calculator-only measure", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(resultPolicies(withCalculatorOnly(seven))).toEqual({
      count: 7,
      named: ["the savings income tax rise", "the gas standing charge abolition"],
      text: "7 policies, the savings income tax rise and the gas standing charge abolition",
    });
    expect(resultPolicies(withCalculatorOnly(["a"])).text).toBe(
      "1 policy, the savings income tax rise and the gas standing charge abolition",
    );
    // Without the calculator's own measures, just the count
    expect(resultPolicies(["a", "b"]).text).toBe("2 policies");
    expect(resultPolicies([]).text).toBe("0 policies");
    // A repeated id counts once
    expect(resultPolicies(["a", "a", SAVINGS_INCOME_RATES_ID]).text).toBe("1 policy and the savings income tax rise");
  });

  it("for any selection, counts exactly the selection and names every calculator-only measure", () => {
    fc.assert(
      fc.property(selection, (selected) => {
        const { count, named, text } = resultPolicies(withCalculatorOnly(selected));
        expect(count).toBe(selected.length);
        expect(text.startsWith(`${selected.length} ${selected.length === 1 ? "policy" : "policies"}`)).toBe(true);
        for (const id of CALCULATOR_ONLY_IDS) {
          expect(named).toContain(CALCULATOR_ONLY_MEASURES[id].phrase);
          expect(text).toContain(CALCULATOR_ONLY_MEASURES[id].phrase);
        }
      }),
    );
  });

  it("for any request, the count plus the named measures is every distinct measure, in any order", () => {
    const request = fc.uniqueArray(fc.oneof(fc.constantFrom(...CALCULATOR_ONLY_IDS), fc.stringMatching(/^[a-z][a-z_]{0,20}$/)), { maxLength: 12 });
    fc.assert(
      fc.property(request, (ids) => {
        const { count, named } = resultPolicies(ids);
        expect(count + named.length).toBe(ids.length);
        expect(named).toHaveLength(ids.filter(isCalculatorOnly).length);
        expect(resultPolicies([...ids].reverse()).count).toBe(count);
      }),
    );
  });

  it("gives every calculator-only measure a phrase to name it by", () => {
    for (const measure of Object.values(CALCULATOR_ONLY_MEASURES)) {
      expect(measure.phrase).toMatch(/^the [a-z]/);
    }
  });
});

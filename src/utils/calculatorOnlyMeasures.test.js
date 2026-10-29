import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SAVINGS_INCOME_RATES_ID,
  definitionChecked,
  isCalculatorOnly,
  withCalculatorOnly,
  withoutCalculatorOnly,
} from "./calculatorOnlyMeasures";
import { policyRows } from "./singleYear";

describe("calculator-only measures", () => {
  it("always go after the selected measures, once, and come off for the national figures", () => {
    expect(withCalculatorOnly(["a", "b"])).toEqual(["a", "b", SAVINGS_INCOME_RATES_ID]);
    expect(withCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID])).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    // Nothing selected: no request, so nothing added
    expect(withCalculatorOnly([])).toEqual([]);
    expect(withoutCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID])).toEqual(["a"]);
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

  it("are left out of the definitions check only while they have no approved definition", () => {
    const IDS = ["a", "b", "c", SAVINGS_INCOME_RATES_ID];
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...IDS)), fc.subarray(IDS), (policies, approvedIds) => {
        const checked = definitionChecked(policies, Object.fromEntries(approvedIds.map((id) => [id, {}])));
        // In the request's order, each one at most once
        expect(checked).toEqual(policies.filter((id) => checked.includes(id)));
        // Every measure with published figures is checked, whether or not
        // it has an approved definition (with none, it is refused)
        for (const id of policies) expect(checked.includes(id)).toBe(!isCalculatorOnly(id) || approvedIds.includes(id));
      }),
      { numRuns: 300 },
    );
    expect(definitionChecked(["a", SAVINGS_INCOME_RATES_ID], null)).toEqual(["a"]);
  });
});

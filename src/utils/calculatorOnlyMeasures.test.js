import { describe, expect, it } from "vitest";
import { SAVINGS_INCOME_RATES_ID, withCalculatorOnly, withoutCalculatorOnly } from "./calculatorOnlyMeasures";
import { policyRows } from "./singleYear";

describe("calculator-only measures", () => {
  it("go after the selected measures, once, and come off for the national figures", () => {
    expect(withCalculatorOnly(["a", "b"], [])).toEqual(["a", "b"]);
    expect(withCalculatorOnly(["a", "b"], [SAVINGS_INCOME_RATES_ID, "unknown"])).toEqual(["a", "b", SAVINGS_INCOME_RATES_ID]);
    expect(withoutCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID])).toEqual(["a"]);
  });

  it("show in the split by policy with their short name and why they are not in the national results", () => {
    const byPolicy = {
      measures: [
        { id: "property_income_rates_up", name: "Property income tax rates up", change: 0, status: "not_affected" },
        { id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax rates up", change: -190, status: "affected" },
      ],
      residual: 0,
    };
    const bars = policyRows(byPolicy, -190, [{ id: "property_income_rates_up", name: "Property income tax up" }], 2027);
    expect(bars.rows).toEqual([expect.objectContaining({ id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax up", rounded: -190 })]);
    expect(bars.notes).toEqual([
      {
        id: SAVINGS_INCOME_RATES_ID,
        name: "Savings income tax up",
        kind: "calculator_only",
        text: "Held back from the national results while our savings data are corrected.",
      },
    ]);
  });
});

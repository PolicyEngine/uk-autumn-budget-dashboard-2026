import { describe, expect, it } from "vitest";
import { lifecycleSelection, lifecycleTotals } from "./lifecycleSelection";

const ALL = [
  "two_child_limit",
  "fuel_duty_freeze",
  "rail_fares_freeze",
  "threshold_freeze_extension",
  "dividend_tax_increase_2pp",
  "savings_tax_increase_2pp",
  "property_tax_increase_2pp",
  "freeze_student_loan_thresholds",
  "salary_sacrifice_cap",
];
const keys = (selection) => selection.reforms.map((r) => r.key);

describe("lifetime series for the selected policies", () => {
  it("maps every policy when all are selected", () => {
    const selection = lifecycleSelection(ALL);
    expect(keys(selection)).toHaveLength(7);
    expect(selection.partialCombined).toBe(false);
    expect(selection.unmodelled).toEqual([]);
  });

  it("shows only the rail series for rail fares alone", () => {
    expect(keys(lifecycleSelection(["rail_fares_freeze"]))).toEqual([
      "impact_rail_fare_freeze",
    ]);
  });

  it("needs all three income tax increases for the combined series", () => {
    const partial = lifecycleSelection(["dividend_tax_increase_2pp", "savings_tax_increase_2pp"]);
    expect(keys(partial)).toEqual([]);
    expect(partial.partialCombined).toBe(true);
    const full = lifecycleSelection([
      "dividend_tax_increase_2pp",
      "savings_tax_increase_2pp",
      "property_tax_increase_2pp",
    ]);
    expect(keys(full)).toEqual(["impact_unearned_income_tax"]);
  });

  it("names selected policies the model does not cover", () => {
    const selection = lifecycleSelection(["new_measure"], [{ id: "new_measure", name: "New measure" }]);
    expect(selection.unmodelled).toEqual(["New measure"]);
  });

  it("totals only the selected series", () => {
    const rows = [
      { impact_rail_fare_freeze: 10, impact_threshold_freeze: -200 },
      { impact_rail_fare_freeze: 12, impact_threshold_freeze: -250 },
    ];
    const rail = lifecycleSelection(["rail_fares_freeze"]).reforms;
    expect(lifecycleTotals(rows, rail)).toEqual({ netTotal: 22, avgPerYear: 11 });
    expect(lifecycleTotals(rows, [])).toEqual({ netTotal: 0, avgPerYear: 0 });
  });
});

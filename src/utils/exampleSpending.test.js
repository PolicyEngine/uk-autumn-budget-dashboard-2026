import { describe, expect, it } from "vitest";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { PETROL_SHARE, SPENDING_BY_GROSS_INCOME_DECILE, decileSpending, grossIncomeDecile } from "./exampleSpending";

describe("the example households' spending", () => {
  it("is ONS Family Spending FYE 2025 Table A6's average for a tenth, a year, petrol and diesel split as Table A1", () => {
    // Table A6: the fourth tenth spends £19.40 a week on electricity and
    // £17.60 on petrol and diesel
    expect(decileSpending(4)).toMatchObject({ electricity: 1010, petrol: 590, diesel: 320 });
    expect(PETROL_SHARE).toBeCloseTo(11.9 / 18.4);
    expect(decileSpending(1).source).toMatch(/lowest tenth by gross income \(ONS Family Spending, FYE 2025, Table A6\)/);
    expect(SPENDING_BY_GROSS_INCOME_DECILE).toHaveLength(10);
  });

  it("places a gross weekly income in its tenth on Table A6's boundaries", () => {
    expect(grossIncomeDecile(255)).toBe(1);
    expect(grossIncomeDecile(465)).toBe(2);
    expect(grossIncomeDecile(471)).toBe(3);
    expect(grossIncomeDecile(2166)).toBe(9);
    expect(grossIncomeDecile(5000)).toBe(10);
  });

  it("differs between the examples, each citing where it comes from", () => {
    const spend = (id) => {
      const { inputs } = HOUSEHOLD_EXAMPLES.find((example) => example.id === id);
      return [inputs.electricity_spending_per_year, inputs.petrol_spending_per_year, inputs.diesel_spending_per_year];
    };
    const pensioner = spend("pensioner-70");
    const renter = spend("bus-commuter");
    const family = spend("family-uc");
    const higher = spend("landlord-saver");
    for (const [a, b] of [[pensioner, renter], [renter, family], [family, higher], [pensioner, higher]]) expect(a).not.toEqual(b);
    for (const example of HOUSEHOLD_EXAMPLES) expect(example.spendingSource, example.id).toMatch(/ONS Family Spending, FYE 2025, Table A6/);
  });
});

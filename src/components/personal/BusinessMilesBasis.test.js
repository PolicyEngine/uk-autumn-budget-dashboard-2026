import { describe, expect, it } from "vitest";
import { assumptionItems } from "./SingleYearResults";

// The result card's "Based on" says how the business miles were counted
// (#357): for an employee, what the employer is taken to pay a mile and
// what the relief lowers; for the self-employed, the flat rate deduction.

const result = (mileage) => ({
  salaryUsed: 40000,
  partnerSalaryUsed: null,
  salaryYear: 2026,
  notModelled: [],
  dependants: [],
  dependantsNote: null,
  councilTax: null,
  area: null,
  mileage,
});
const rates = (firstMiles, furtherMiles) => ({ firstMiles, furtherMiles });
const mileage = (overrides = {}) => ({
  miles: 15000,
  role: "EMPLOYEE",
  applied: true,
  currentLawRates: rates(0.55, 0.25),
  budgetRates: rates(0.55, 0.35),
  employerRates: rates(0.55, 0.25),
  deductionChange: 500,
  ...overrides,
});
const milesItem = (data, yearLabel = "2027-28") =>
  assumptionItems(data, yearLabel).find((item) => item.id === "business-miles");

describe("business miles in the result's Based on", () => {
  it("says what an employee's employer is taken to pay a mile, and what the relief lowers", () => {
    expect(milesItem(result(mileage()))).toEqual({
      id: "business-miles",
      label: "Business miles",
      value: "15,000 a year, as an employee",
      detail:
        "Your employer is taken to pay 55p a mile for the first 10,000 and 25p above, before and after the Budget. You claim Mileage Allowance Relief on the Budget's extra 10p a mile above 10,000, which lowers income tax and any student loan repayments.",
    });
  });

  it("gives a self-employed driver's flat rate deduction, with no employer", () => {
    expect(milesItem(result(mileage({ role: "SELF_EMPLOYED", employerRates: null })))).toEqual({
      id: "business-miles",
      label: "Business miles",
      value: "15,000 a year, self-employed",
      detail:
        "The flat rate deduction comes off your self-employment profit: 55p a mile for the first 10,000 and 25p above, with the Budget's 35p above 10,000. It lowers income tax, Class 4 National Insurance and any student loan repayments; Universal Credit keeps its own 45p and 25p.",
    });
  });

  it("says the Budget changes nothing in a year its rates are current law's", () => {
    const sameRates = mileage({ budgetRates: rates(0.55, 0.25), deductionChange: 0 });
    expect(milesItem(result(sameRates), "2026-27").detail).toBe(
      "Your employer is taken to pay 55p a mile for the first 10,000 and 25p above, before and after the Budget. The Budget does not change the rates in 2026-27.",
    );
  });

  it("is left out with no business miles, or when the mileage measure was not applied", () => {
    expect(milesItem(result(null))).toBeUndefined();
    expect(milesItem(result(mileage({ applied: false })))).toBeUndefined();
  });
});

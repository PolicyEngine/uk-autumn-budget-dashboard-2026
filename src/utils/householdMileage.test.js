import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildHouseholdRequest, businessMiles, requestKey } from "./householdImpactApi";
import {
  CALCULATOR_ONLY_MEASURES,
  MILEAGE_RATES_ID,
  SAVINGS_INCOME_RATES_ID,
  isCalculatorOnly,
  resultPolicies,
  withCalculatorOnly,
  withoutCalculatorOnly,
} from "./calculatorOnlyMeasures";
import { WIZARD_DEFAULTS } from "./householdDefaults";
import { EXAMPLE_ANSWERS } from "./exampleAnswers";

// The household-only mileage measure (#357): the head's business miles a
// year in their own car or van, and whether they drive them as an employee
// or self-employed. Sent, with the measure, only once miles are entered.

const OPTIONS = { year: 2027, policies: ["fuel_duty_rise_deferral"] };
const withMiles = (miles, role) => ({
  ...WIZARD_DEFAULTS,
  business_miles_per_year: miles,
  ...(role ? { business_miles_role: role } : {}),
});

describe("business miles in the household request", () => {
  it("are none by default, and a household without them is sent exactly as before", () => {
    expect(WIZARD_DEFAULTS.business_miles_per_year).toBe(0);
    expect(WIZARD_DEFAULTS.business_miles_role).toBe("EMPLOYEE");
    const none = buildHouseholdRequest(WIZARD_DEFAULTS, OPTIONS);
    expect(none.household).not.toHaveProperty("business_miles");
    expect(none.household).not.toHaveProperty("business_miles_role");
    // Answers from before the question, an empty box and a role chosen
    // without miles: all the same request
    const { business_miles_per_year: _miles, business_miles_role: _role, ...older } = WIZARD_DEFAULTS;
    for (const answers of [older, withMiles(null), withMiles(0, "SELF_EMPLOYED")]) {
      expect(requestKey(buildHouseholdRequest(answers, OPTIONS))).toBe(requestKey(none));
    }
  });

  it("send whole miles and the role once miles are entered", () => {
    expect(buildHouseholdRequest(withMiles(15000), OPTIONS).household).toMatchObject({
      business_miles: 15000,
      business_miles_role: "EMPLOYEE",
    });
    expect(buildHouseholdRequest(withMiles(6000, "SELF_EMPLOYED"), OPTIONS).household).toMatchObject({
      business_miles: 6000,
      business_miles_role: "SELF_EMPLOYED",
    });
  });

  it("are read as whole miles, and as none when not a positive number", () => {
    expect(businessMiles(withMiles(15000))).toBe(15000);
    expect(businessMiles(withMiles(15000.4))).toBe(15000);
    for (const value of [0, -5, null, undefined, Number.NaN, "15000"]) {
      expect(businessMiles(withMiles(value))).toBe(0);
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (miles) => {
        expect(buildHouseholdRequest(withMiles(miles), OPTIONS).household.business_miles).toBe(miles);
      }),
    );
  });

  it("leave every example's request as it was", () => {
    expect(EXAMPLE_ANSWERS.business_miles_per_year).toBe(0);
    expect(buildHouseholdRequest(EXAMPLE_ANSWERS, OPTIONS).household).not.toHaveProperty("business_miles");
  });
});

describe("the mileage measure in a household's request", () => {
  it("is added after the selection only when the answers have business miles", () => {
    expect(isCalculatorOnly(MILEAGE_RATES_ID)).toBe(true);
    expect(withCalculatorOnly(["a"], WIZARD_DEFAULTS)).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    expect(withCalculatorOnly(["a"], withMiles(15000))).toEqual(["a", SAVINGS_INCOME_RATES_ID, MILEAGE_RATES_ID]);
    // Without answers (the examples' requests): never
    expect(withCalculatorOnly(["a"])).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    // Nothing selected: no request, so nothing added
    expect(withCalculatorOnly([], withMiles(15000))).toEqual([]);
    // Off again for the national figures
    expect(withoutCalculatorOnly(withCalculatorOnly(["a"], withMiles(15000)))).toEqual(["a"]);
  });

  it("is named after the count in the result", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(resultPolicies(withCalculatorOnly(seven, withMiles(15000))).text).toBe(
      "7 policies, the savings income tax rise and the tax-free mileage rates rise",
    );
    expect(CALCULATOR_ONLY_MEASURES[MILEAGE_RATES_ID].name).toBe("Tax-free mileage rates up");
  });
});

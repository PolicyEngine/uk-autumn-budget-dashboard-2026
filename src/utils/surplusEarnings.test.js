import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MONTHS_IN_YEAR,
  SURPLUS_EARNINGS_ID,
  asksMonthlyPay,
  monthlyPay,
  normaliseSurplusEarnings,
  policyYearMonths,
  sendsMonthlyPay,
  surplusIncluded,
} from "./surplusEarnings";
import { SURPLUS_BLOCK, SURPLUS_NOT_REACHED } from "../test/surplusEarningsFixture";

describe("the months of a policy year", () => {
  it("run April to March, named in full and in short", () => {
    const months = policyYearMonths(2027);
    expect(months).toHaveLength(MONTHS_IN_YEAR);
    expect(months[0]).toEqual({ key: "2027-04", label: "April 2027", short: "Apr" });
    expect(months[8]).toEqual({ key: "2027-12", label: "December 2027", short: "Dec" });
    expect(months[9]).toEqual({ key: "2028-01", label: "January 2028", short: "Jan" });
    expect(months[11]).toEqual({ key: "2028-03", label: "March 2028", short: "Mar" });
  });
});

describe("monthly pay", () => {
  it("is asked only of a household that would claim Universal Credit, in Great Britain", () => {
    expect(asksMonthlyPay({ claims_universal_credit: true, region: "NORTH_WEST" })).toBe(true);
    expect(asksMonthlyPay({ claims_universal_credit: true, region: "SCOTLAND" })).toBe(true);
    expect(asksMonthlyPay({ claims_universal_credit: false, region: "NORTH_WEST" })).toBe(false);
    expect(asksMonthlyPay({ claims_universal_credit: true, region: "NORTHERN_IRELAND" })).toBe(false);
  });

  it("is sent only once the box is ticked, where it is asked", () => {
    const asked = { claims_universal_credit: true, region: "LONDON" };
    expect(sendsMonthlyPay(asked)).toBe(false);
    expect(sendsMonthlyPay({ ...asked, monthly_income_varies: true })).toBe(true);
    expect(sendsMonthlyPay({ ...asked, monthly_income_varies: true, claims_universal_credit: false })).toBe(false);
    expect(sendsMonthlyPay({ ...asked, monthly_income_varies: true, region: "NORTHERN_IRELAND" })).toBe(false);
  });

  it("is the months entered, and the yearly salary spread evenly for any not entered", () => {
    expect(monthlyPay(null, 34200)).toEqual(Array(12).fill(2850));
    expect(monthlyPay(undefined, 20000)).toEqual(Array(12).fill(1666.67));
    const entered = [1500, 1500, 1500, 1500, 1500, 6000, 1500, 1500, 1500, 1500, 1500, 1500];
    expect(monthlyPay(entered, 34200)).toEqual(entered);
    // A month left empty takes the even share
    expect(monthlyPay([1000, null, ...Array(10).fill(1000)], 24000)).toEqual([1000, 2000, ...Array(10).fill(1000)]);
  });

  it("is always twelve finite amounts of £0 or more", () => {
    const entry = fc.option(fc.double({ min: 0, max: 50000, noNaN: true }), { nil: null });
    fc.assert(
      fc.property(fc.option(fc.array(entry, { maxLength: 14 }), { nil: null }), fc.double({ min: 0, max: 500000, noNaN: true }), (months, yearly) => {
        const pay = monthlyPay(months, yearly);
        expect(pay).toHaveLength(MONTHS_IN_YEAR);
        for (const amount of pay) {
          expect(Number.isFinite(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});

describe("the answer's month figures", () => {
  it("read the API's block: the change, the thresholds and each month at both", () => {
    const surplus = normaliseSurplusEarnings(SURPLUS_BLOCK);
    expect(surplus).toMatchObject({
      id: SURPLUS_EARNINGS_ID,
      status: "affected",
      change: 482.02,
      thresholds: { currentLaw: 300, budget: 2500 },
      total: { currentLaw: 10468.92, budget: 10950.94 },
    });
    expect(surplus.months).toHaveLength(12);
    expect(surplus.months[5]).toMatchObject({
      key: "2027-09",
      label: "September 2027",
      pay: 6000,
      earnedIncome: 4359.78,
      nilThreshold: 3183.38,
      currentLaw: { universalCredit: 0, status: "award_ended", surplusCarried: 876.4 },
      budget: { universalCredit: 0, status: "award_ended", surplusCarried: 0 },
    });
    expect(surplus.months[6].currentLaw).toMatchObject({ universalCredit: 513.52, status: "new_award", claim: 1, surplusCounted: 876.4 });
    expect(surplusIncluded(surplus)).toBe(true);
  });

  it("are null without the block, and a household the measure cannot reach has its reason and no months", () => {
    expect(normaliseSurplusEarnings(null)).toBeNull();
    expect(normaliseSurplusEarnings(undefined)).toBeNull();
    const notReached = normaliseSurplusEarnings(SURPLUS_NOT_REACHED);
    expect(notReached).toMatchObject({ status: "not_affected", reason: "same_threshold", change: 0, months: null });
    expect(notReached.note).toMatch(/same with or without the Budget/);
    // Included, at £0: the result names it
    expect(surplusIncluded(notReached)).toBe(true);
    expect(surplusIncluded(null)).toBe(false);
  });
});

/**
 * The household API's `surplus_earnings` block for a renting single parent
 * in the North West, one child aged 5, £750 rent, paid £1,500 a month with
 * £6,000 in September 2027 (tests/test_household_surplus_earnings.py's
 * household; figures from calculate_household_impact on policyengine-uk
 * 2.151.0, 29 October 2026). September's pay ends the award; at £300 the
 * October claim counts £876.40 of surplus, at £2,500 none: +£482.02.
 */
const awardMonth = (month, pay = 1500) => ({
  month,
  employment_income: pay,
  partner_employment_income: null,
  total_earned_income: 1373.3,
  nil_uc_threshold: 3183.38,
  universal_credit_without_surplus: 995.54,
  current_law: { universal_credit: 995.54, status: "award", claim: null, surplus_counted: 0, surplus_carried: 0 },
  budget: { universal_credit: 995.54, status: "award", claim: null, surplus_counted: 0, surplus_carried: 0 },
});

export const SURPLUS_BLOCK = {
  id: "universal_credit_surplus_earnings",
  name: "Universal Credit surplus earnings threshold kept at £2,500",
  status: "affected",
  reason: null,
  note: null,
  thresholds: { current_law: 300, budget: 2500 },
  change: 482.02,
  own_change: null,
  total: { current_law: 10468.92, budget: 10950.94 },
  months: [
    ...["2027-04", "2027-05", "2027-06", "2027-07", "2027-08"].map((month) => awardMonth(month)),
    {
      ...awardMonth("2027-09", 6000),
      total_earned_income: 4359.78,
      universal_credit_without_surplus: 0,
      current_law: { universal_credit: 0, status: "award_ended", claim: null, surplus_counted: 0, surplus_carried: 876.4 },
      budget: { universal_credit: 0, status: "award_ended", claim: null, surplus_counted: 0, surplus_carried: 0 },
    },
    {
      ...awardMonth("2027-10"),
      current_law: { universal_credit: 513.52, status: "new_award", claim: 1, surplus_counted: 876.4, surplus_carried: 0 },
      budget: { universal_credit: 995.54, status: "new_award", claim: 1, surplus_counted: 0, surplus_carried: 0 },
    },
    ...["2027-11", "2027-12", "2028-01", "2028-02", "2028-03"].map((month) => awardMonth(month)),
  ],
  method:
    "Worked out month by month, April to March, from the monthly pay entered. Every other figure comes from the yearly salary.",
};

/** The same household with no months: a year the measure changes nothing. */
export const SURPLUS_NOT_REACHED = {
  ...SURPLUS_BLOCK,
  status: "not_affected",
  reason: "same_threshold",
  note: "The threshold is the same with or without the Budget in this year: £2,500 for claims to March 2027, and £300 from April 2028. The Budget keeps £2,500 for claims from April 2027 to March 2028.",
  change: 0,
  own_change: 0,
  total: null,
  months: null,
};

/**
 * The Household impact form's defaults, with their sources. Every field has
 * one, so the results show before anything is changed.
 *
 * Salary: ONS, Annual Survey of Hours and Earnings (ASHE) 2026 provisional,
 * Table 6.7a "Annual pay - Gross", all employee jobs, UK: median £34,229
 * (April 2026; employees on adult rates in the same job for more than a
 * year), rounded to £34,200. The form asks for salary in 2026, so the
 * year matches.
 * https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6
 *
 * Rent: ONS, Price Index of Private Rents (PIPR), average monthly private
 * rent by region, September 2026 (Northern Ireland: July 2026, its latest),
 * published 21 October 2026.
 * https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics
 *
 * Spending: ONS, Family Spending in the UK, FYE 2025, Workbook 1, Table A1,
 * average weekly household spending × 52, rounded to £10: petrol £11.90
 * (£620 a year), diesel £6.50 (£340), electricity (line 4.4.1) £20.00
 * (£1,040; the API's own default, ELECTRICITY_SPENDING).
 * https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends
 */

/** ASHE 2026 provisional median, all employee jobs, rounded. */
export const DEFAULT_SALARY = 34200;
export const SALARY_SOURCE =
  "£34,200 is the UK median salary in April 2026 (ONS Annual Survey of Hours and Earnings, provisional).";

/** Average monthly private rent by region (ONS PIPR, September 2026). */
export const REGIONAL_RENT = {
  NORTH_EAST: 790,
  NORTH_WEST: 975,
  YORKSHIRE: 869,
  EAST_MIDLANDS: 928,
  WEST_MIDLANDS: 983,
  EAST_OF_ENGLAND: 1298,
  LONDON: 2338,
  SOUTH_EAST: 1438,
  SOUTH_WEST: 1251,
  WALES: 848,
  SCOTLAND: 1011,
  // July 2026, Northern Ireland's latest month
  NORTHERN_IRELAND: 879,
};

/** The region's average private rent; the UK's (£1,406) for an unknown region. */
export const regionalRent = (region) => REGIONAL_RENT[region] ?? 1406;

/** Average household spending a year (ONS Family Spending, FYE 2025). */
export const DEFAULT_SPENDING = {
  petrol: 620,
  diesel: 340,
  electricity: 1040,
};

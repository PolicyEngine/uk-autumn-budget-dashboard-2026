/**
 * Named external sources the dashboard links to, in one place, so each tab
 * (and Methodology) links the same page. Every URL was checked to load the
 * page named on 25 October 2026. A source whose page does not exist yet
 * has `href: null`, and is written as plain text until it does.
 *
 * Link style (.claude/CLAUDE.md): meaningful anchor text, opened in a new
 * tab with rel="noopener noreferrer" (SourceLink).
 */
export const SOURCES = {
  obrEfoMarch2026: {
    label: "OBR Economic and fiscal outlook, March 2026",
    href: "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
  },
  // Published with the Budget on 28 October 2026; linked once it exists
  obrBudget2026Costings: {
    label: "the OBR's Autumn Budget 2026 costings (28 October 2026)",
    href: null,
  },
  hbai: {
    label: "DWP Households Below Average Income",
    href: "https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025",
  },
  familyResourcesSurvey: {
    label: "Family Resources Survey",
    href: "https://www.gov.uk/government/collections/family-resources-survey--2",
  },
  onsFamilySpending: {
    label: "ONS Family Spending",
    href: "https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends",
  },
  onsA05: {
    label: "ONS labour market by age (A05)",
    href: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/datasets/employmentunemploymentandeconomicinactivitybyagegroupseasonallyadjusteda05sa",
  },
  onsAshe: {
    label: "ONS Annual Survey of Hours and Earnings",
    href: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6",
  },
  onsPrivateRents: {
    label: "ONS Price Index of Private Rents",
    href: "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics",
  },
  mhclgCouncilTax: {
    label: "MHCLG council tax levels, 2026 to 2027",
    href: "https://www.gov.uk/government/statistics/council-tax-levels-set-by-local-authorities-in-england-2026-to-2027",
  },
  hmrcRatesAllowances: {
    label: "HMRC rates and allowances",
    href: "https://www.gov.uk/government/collections/rates-and-allowances-hm-revenue-and-customs",
  },
  warmHomeDiscount: {
    label: "Warm Home Discount",
    href: "https://www.gov.uk/the-warm-home-discount-scheme",
  },
  peUk2616: {
    label: "policyengine-uk #2616",
    href: "https://github.com/PolicyEngine/policyengine-uk/pull/2616",
  },
  peUk2428: {
    label: "policyengine-uk #2428",
    href: "https://github.com/PolicyEngine/policyengine-uk/pull/2428",
  },
  microcosm: {
    label: "Microcosm",
    href: "https://github.com/PolicyEngine/microcosm",
  },
  policyenginePy: {
    label: "policyengine.py 6.10.2",
    href: "https://pypi.org/project/policyengine/6.10.2/",
  },
};

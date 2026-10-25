/**
 * The external sources the page names, each once: id → { label, url }.
 * Link text comes from `label`; every link opens in a new tab. Each URL was
 * checked to load the page it names on 25 October 2026.
 */
export const SOURCES = {
  obr_efo_march_2026: {
    label: "OBR, Economic and fiscal outlook – March 2026",
    url: "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
  },
  frs_2024_25: {
    label: "DWP, Family Resources Survey: financial year 2024 to 2025",
    url: "https://www.gov.uk/government/statistics/family-resources-survey-financial-year-2024-to-2025",
  },
  dwp_hbai: {
    label: "DWP, Households Below Average Income: FYE 1995 to FYE 2025",
    url: "https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025",
  },
  ons_a05_sa: {
    label: "ONS, A05 SA: Employment, unemployment and economic inactivity by age group",
    url: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/datasets/employmentunemploymentandeconomicinactivitybyagegroupseasonallyadjusteda05sa",
  },
  ons_mid_year_estimates: {
    label: "ONS, Population estimates for the UK, England, Wales, Scotland and Northern Ireland",
    url: "https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/bulletins/annualmidyearpopulationestimates/latest",
  },
  ons_family_spending: {
    label: "ONS, Family spending workbook 1: detailed expenditure and trends",
    url: "https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends",
  },
  desnz_whd_ia: {
    label: "DESNZ, Continuing the Warm Home Discount 2026-2031: final stage impact assessment",
    url: "https://assets.publishing.service.gov.uk/media/6978a8b51c24881f40a4d675/continuing-the-warm-home-discount-scheme-impact-assessment.pdf",
  },
  mhclg_council_tax: {
    label: "MHCLG, Council Tax levels set by local authorities in England 2026 to 2027",
    url: "https://www.gov.uk/government/statistics/council-tax-levels-set-by-local-authorities-in-england-2026-to-2027",
  },
  wales_council_tax: {
    label: "Welsh Government, Council Tax levels: April 2026 to March 2027",
    url: "https://www.gov.wales/council-tax-levels-april-2026-march-2027-html",
  },
  scotland_council_tax: {
    label: "Scottish Government, Council tax datasets",
    url: "https://www.gov.scot/publications/council-tax-datasets/",
  },
  hmrc_employer_rates: {
    label: "HMRC, Rates and thresholds for employers 2026 to 2027",
    url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
  },
  pe_uk_2616: {
    label: "policyengine-uk #2616",
    url: "https://github.com/PolicyEngine/policyengine-uk/pull/2616",
  },
  pe_uk_2428: {
    label: "PolicyEngine/policyengine-uk#2428",
    url: "https://github.com/PolicyEngine/policyengine-uk/pull/2428",
  },
  policyengine_py_release: {
    label: "policyengine.py 6.10.2",
    url: "https://github.com/PolicyEngine/policyengine.py/releases/tag/6.10.2",
  },
  microcosm: {
    label: "Microcosm",
    url: "https://github.com/PolicyEngine/microcosm",
  },
};

/** Attributes for a link to an external source. */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" };

/**
 * Sources only the other tabs name (merged with the shared list above, so
 * Methodology's file and this one differ only by these added keys).
 * A source whose page does not exist yet has `url: null` and is written as
 * plain text until it does.
 */
Object.assign(SOURCES, {
  // The forecast the page uses, linked in the intro.
  // Update on Budget day (runbook step): the October 2026 EFO page.
  obr_efo_current: {
    label: "OBR, Economic and fiscal outlook – March 2026",
    url: "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
  },
  // Where the measures and their costings are read from, linked in the intro.
  // Update on Budget day (runbook step): the Autumn Budget 2026 document and
  // its policy costings on gov.uk. Before the Budget, HM Treasury's page.
  budget_documents: {
    label: "HM Treasury",
    url: "https://www.gov.uk/government/organisations/hm-treasury",
  },
  // Published with the Budget on 28 October 2026; linked once it exists
  obr_budget_2026_costings: {
    label: "the OBR's Autumn Budget 2026 costings (28 October 2026)",
    url: null,
  },
  ons_ashe: {
    label: "ONS, Annual Survey of Hours and Earnings",
    url: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6",
  },
  ons_private_rents: {
    label: "ONS, Price Index of Private Rents",
    url: "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics",
  },
  hmrc_rates_allowances: {
    label: "HMRC, Rates and allowances",
    url: "https://www.gov.uk/government/collections/rates-and-allowances-hm-revenue-and-customs",
  },
  warm_home_discount: {
    label: "Warm Home Discount",
    url: "https://www.gov.uk/the-warm-home-discount-scheme",
  },
});

/**
 * The external sources the page names, each once: id → { label, url }.
 * Link text comes from `label`; every link opens in a new tab. Each URL was
 * checked to load the page it names on 25 October 2026.
 */
export const SOURCES = {
  obr_fiscal_risks: {
    label: "OBR, Fiscal risks and sustainability – July 2026",
    url: "https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/",
  },
  // The OBR forecast the Budget figures' simulations are built on
  // (src/uk_budget_data/forecast/obr_october_2026.json over policyengine-uk's
  // economic assumptions; data_inputs/publication_basis.json), so every
  // place that names it describes the Budget runs. The Pre-measures
  // forecast tab's projections are on it too (outlookForecastSource); March
  // 2026 (obr_efo_march_2026) stays beside it on Forecast changes.
  obr_efo_current: {
    label: "OBR, Economic and fiscal outlook – October 2026",
    url: "https://obr.uk/download/economic-and-fiscal-outlook-october-2026/",
  },
  obr_efo_march_2026: {
    label: "OBR, Economic and fiscal outlook – March 2026",
    url: "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
  },
  // The Budget's OBR forecast, shown beside March 2026 on the Pre-measures
  // forecast tab; the EFO page itself was not up on 28 October 2026, so this
  // is the PDF it publishes
  obr_efo_october_2026: {
    label: "OBR, Economic and fiscal outlook – October 2026",
    url: "https://obr.uk/download/economic-and-fiscal-outlook-october-2026/",
  },
  // The October 2026 forecast's detailed tables (economy): the overlay's
  // growth rates are read from them at four decimals (Table 1.6 for
  // average earnings; src/uk_budget_data/forecast/obr_october_2026.json).
  // The EFO page lists them under its supporting documents (checked 28
  // October 2026)
  obr_efo_october_2026_tables: {
    label: "OBR, Economic and fiscal outlook – October 2026: detailed forecast tables (economy)",
    url: "https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/",
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
  hmrc_income_tax_rates: {
    label: "HMRC, Income Tax rates and allowances",
    url: "https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past",
  },
  hmrc_ni_rates: {
    label: "HMRC, Rates and allowances: National Insurance contributions",
    url: "https://www.gov.uk/government/publications/rates-and-allowances-national-insurance-contributions/rates-and-allowances-national-insurance-contributions",
  },
  student_loan_thresholds: {
    label: "GOV.UK, Repaying your student loan: how much you repay",
    url: "https://www.gov.uk/repaying-your-student-loan/what-you-pay",
  },
  policyengine_uk: {
    label: "policyengine-uk",
    url: "https://github.com/PolicyEngine/policyengine-uk",
  },
  constituency_method_note: {
    label: "Method note for constituency figures",
    url: "https://github.com/PolicyEngine/microcosm/issues/1131",
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
    label: "policyengine.py 6.11.1",
    url: "https://github.com/PolicyEngine/policyengine.py/releases/tag/6.11.1",
  },
  microcosm: {
    label: "Microcosm",
    url: "https://github.com/PolicyEngine/microcosm",
  },
  // Microcosm's own site, and PolicyEngine's pages on how Microcosm UK is
  // built, stage by stage, and on its calibration targets (all checked 27
  // October 2026). The targets page names the release it lists.
  microcosm_site: {
    label: "Microcosm",
    url: "https://microcosm.institute",
  },
  uk_data_pipeline: {
    label: "PolicyEngine, UK microdata pipeline",
    url: "https://www.policyengine.org/uk/model/data/pipeline",
  },
  uk_calibration_targets: {
    label: "PolicyEngine, UK calibration targets",
    url: "https://www.policyengine.org/uk/model/data/calibration",
  },
  // Section 8, Equivalisation: HBAI's modified OECD scale (checked 26 October 2026)
  // The evaluation policyengine-uk's single fare bands are fitted to, for
  // the £2 bus fare cap (checked 29 October 2026)
  dft_two_pound_cap_evaluation: {
    label: "DfT, Evaluation of the £2 bus fare cap",
    url: "https://www.gov.uk/government/publications/evaluation-of-the-2-bus-fare-cap",
  },
  dwp_hbai_methodology: {
    label: "DWP, Households Below Average Income: background information and methodology",
    url: "https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025/households-below-average-income-background-information-and-methodology-report-fye-2025",
  },
  policyengine_uk_parameters: {
    label: "policyengine-uk parameters",
    url: "https://github.com/PolicyEngine/policyengine-uk/tree/main/policyengine_uk/parameters",
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
  // The model, named in the intro
  policyengine_uk_model: {
    label: "PolicyEngine UK",
    url: "https://policyengine.org/uk/model",
  },
  // Where the measures are read from: the Budget 2026 document on gov.uk
  // (published 28 October 2026)
  budget_documents: {
    label: "HM Treasury, Budget 2026",
    url: "https://www.gov.uk/government/publications/budget-2026-document",
  },
  // HM Treasury's Budget 2026 policy costings, certified by the OBR,
  // published 28 October 2026 (the policy costings PDF from gov.uk's
  // supporting documents page): the figures the reconciliation gate compares
  // (public/data/official_costings.json, from Table 6.1)
  obr_budget_2026_costings: {
    label: "the official Autumn Budget 2026 costings (HM Treasury, certified by the OBR)",
    url: "https://assets.publishing.service.gov.uk/media/6ae1883fe4367e5c8b0467df/AB26_Policy_Costing.pdf",
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

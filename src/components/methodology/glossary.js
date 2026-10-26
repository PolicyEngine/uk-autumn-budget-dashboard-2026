/**
 * The terms the charts share, each defined once: in the Methodology
 * view's "Terms used on the charts" (MethodGlossary), where each has its
 * own anchor. A card's "About this chart" names a shared term and links
 * here rather than restating it (InfoSections' definitions, `{ ref }`).
 * A term only one card uses is defined in that card instead. `sources`
 * links a phrase of the meaning to its source (src/utils/sources.js); the
 * meaning stays plain text for any other use.
 */
export const GLOSSARY = {
  netIncome: {
    term: "Household net income",
    meaning:
      "Earnings, pensions and other income plus benefits, less taxes (income tax, National Insurance, council tax, VAT, fuel duty and the other taxes the model gives households), student loan repayments and pension contributions.",
  },
  housingCosts: {
    term: "Before and after housing costs (BHC, AHC)",
    meaning:
      "Household net income before or after rent, mortgage interest, water rates and other housing costs are taken off, as in the official Households Below Average Income statistics.",
    sources: { "Households Below Average Income": "dwp_hbai" },
  },
  equivalised: {
    term: "Equivalised income",
    meaning:
      "Household net income adjusted for the household's size and make-up (the modified OECD scale), so households of different sizes compare; shown as the income of a couple with no children.",
    // HBAI's methodology report explains the scale (its section 8)
    sources: { "modified OECD scale": "dwp_hbai_methodology" },
  },
  median: {
    term: "Median",
    meaning: "The middle income when people are ranked by income: half have more, half less. The mean is the average.",
  },
  incomeGroups: {
    term: "Deciles, quintiles and vigintiles",
    meaning:
      "Tenths, fifths and twentieths of people, ranked by equivalised household income. Each holds the same number of people.",
  },
  real: {
    term: "Real terms and cash terms",
    meaning:
      "Real figures are adjusted for price rises to one year's prices (CPI; CPI after housing costs for incomes after housing costs); cash figures are not.",
  },
  points: {
    term: "Percentage points",
    meaning: "The difference between two percentages: a rate going from 12% to 11% falls by 1 percentage point, which is a fall of about 8%.",
  },
  absolutePoverty: {
    term: "Absolute poverty",
    meaning:
      "Living in a household with income below 60% of the 2024-25 median, a line held fixed in real terms. Relative poverty uses 60% of each year's own median.",
  },
  gini: {
    term: "Gini coefficient",
    meaning: "A measure of income inequality from 0 (everyone has the same income) to 1 (one person has all of it).",
  },
  perPerson: {
    term: "Change per person",
    meaning:
      "Results by age give each person their whole household's change in net income, not a share of it, and average over the people in each age.",
  },
  ownRuns: {
    term: "Measures run on their own",
    meaning:
      "Each measure is also simulated on its own against current law. Their separate effects leave out how measures interact, so they need not add up to the whole selection's effect.",
  },
  static: {
    term: "Static estimates",
    meaning:
      "People do not change their behaviour in response to a measure: work, spending and wages stay as they were, so the figures leave out knock-on effects.",
  },
  benefitUnit: {
    term: "Benefit unit",
    meaning: "A single adult or a couple, with any dependent children: the family that claims benefits together.",
  },
  statePensionAge: {
    term: "State Pension age",
    meaning: "66 in 2026-27 and 67 from 2027-28, as in policyengine-uk. Pensioners are people at or over it.",
    sources: { "policyengine-uk": "policyengine_uk" },
  },
};

/** A term's anchor in the Methodology view. */
export const glossaryAnchor = (key) => `term-${key}`;

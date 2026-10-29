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
      "Earnings, pensions, other income and benefits, less direct taxes, Council Tax, fuel and other duties, student loan repayments and pension contributions; a change in VAT counts too.",
  },
  housingCosts: {
    term: "Before and after housing costs (BHC, AHC)",
    meaning:
      "Net income before or after rent, mortgage interest and other housing costs, as in Households Below Average Income.",
    sources: { "Households Below Average Income": "dwp_hbai" },
  },
  equivalised: {
    term: "Equivalised income",
    meaning:
      "Net income adjusted for household size and make-up (the modified OECD scale), in terms of a couple with no children.",
    // HBAI's methodology report explains the scale (its section 8)
    sources: { "modified OECD scale": "dwp_hbai_methodology" },
  },
  median: {
    term: "Median",
    meaning: "The middle income in a ranking of people by income; the mean is the average.",
  },
  incomeGroups: {
    term: "Deciles, quintiles and vigintiles",
    meaning: "Tenths, fifths and twentieths of people, by equivalised household income.",
  },
  real: {
    term: "Real terms and cash terms",
    meaning:
      "Real figures take out price rises (CPI, or CPI after housing costs for incomes after housing costs); cash figures do not.",
  },
  points: {
    term: "Percentage points",
    meaning: "The gap between two percentages: 12% to 11% is a fall of 1 point, or about 8%.",
  },
  absolutePoverty: {
    term: "Absolute poverty",
    meaning:
      "Income below 60% of the 2024-25 median, which stays fixed in real terms. Relative poverty uses each year's own median.",
  },
  gini: {
    term: "Gini coefficient",
    meaning: "Income inequality on a scale from 0 (everyone has the same income) to 1 (one person has it all).",
  },
  perPerson: {
    term: "Change per person",
    meaning: "In results by age, each person counts their whole household's change, and the figure averages it over the people in the group.",
  },
  ownRuns: {
    term: "Policies we run on their own",
    meaning:
      "A simulation of each policy alone against current law; adding these up leaves out how policies interact.",
  },
  static: {
    term: "Static estimates",
    meaning:
      "People do not change their behaviour in response to a policy: work, spending and wages stay as they were.",
  },
  benefitUnit: {
    term: "Benefit unit",
    meaning: "A single adult or a couple, with any dependent children: the family that claims benefits together.",
  },
  statePensionAge: {
    term: "State Pension age",
    meaning:
      "Rises from 66 to 67 between April 2026 and March 2028, by date of birth. Pensioners here are people aged 66 or over in 2026-27 and 67 or over from 2027-28.",
  },
};

/** A term's anchor in the Methodology view. */
export const glossaryAnchor = (key) => `term-${key}`;

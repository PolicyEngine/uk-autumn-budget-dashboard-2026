/** Our published write-ups on this Budget, on policyengine.org. */
export const RESEARCH_URL = "https://www.policyengine.org/uk/research";

/**
 * Our briefing, then each explainer, by its post's slug, with the measures
 * it explains: registry ids, and an unmodelled card's id
 * (unmodelledMeasures.js) for a measure the dashboard shows only as that
 * card. The titles name posts, not measures: a link shows whatever the
 * publication holds, so a measure that is not published keeps its post, and
 * a card shows its explainer only while the card shows.
 */
export const EXPLAINERS = [
  { slug: "uk-autumn-budget-2026-briefing", title: "Our briefing on what the Budget means for households", measures: [] },
  { slug: "budget-2026-energy-bills", title: "The energy bill measures", measures: ["domestic_electricity_zero_vat", "household_energy_payment_2026"] },
  { slug: "fuel-duty-cut-extension", title: "The fuel duty cut extension", measures: ["fuel_duty_rise_deferral"] },
  { slug: "pension-tax-allowance", title: "The Pension Tax Allowance", measures: ["state_pension_income_tax_protection"] },
  { slug: "uk-autumn-budget-2026-property-income-tax", title: "Higher tax on property income", measures: ["property_income_rates_up"] },
  { slug: "uk-autumn-budget-2026-trading-allowance", title: "Raising the trading allowance", measures: ["trading_allowance_raise"] },
  { slug: "carers-allowance-taper", title: "The Carer's Allowance earnings taper", measures: ["carers_allowance_earnings_taper"] },
  { slug: "uk-triple-lock-budget-2026", title: "The adjusted Triple Lock", measures: ["state_pension_double_lock_2030", "adjusted-triple-lock"] },
];

/** The explainer for a measure, as { title, href }, or null if we have none. */
export function explainerFor(measureId) {
  const post = EXPLAINERS.find(({ measures }) => measures.includes(measureId));
  return post ? { title: post.title, href: `${RESEARCH_URL}/${post.slug}` } : null;
}

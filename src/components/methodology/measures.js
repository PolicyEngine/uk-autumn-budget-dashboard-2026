/**
 * How the national run represents each measure, for the Methodology view's
 * table, from the approved catalogue: the measure's published modelling
 * note (`display.modelling`, from src/uk_budget_data/reforms.py), else its
 * public description, and the first model year it changes
 * (`display.modelled_from`), else its first supported year. Year 2027
 * means 2027-28. The policy descriptions themselves stay with the Policies
 * section of Population impact.
 */
export function measureModelling(catalogue) {
  return catalogue.displayable.map((measure) => ({
    ...measure,
    how: measure.display?.modelling || measure.description,
    from:
      measure.display?.modelled_from ??
      measure.years.filter((year) => !measure.unsupported_years.includes(year)).sort((a, b) => a - b)[0] ??
      null,
  }));
}

/**
 * Measures reported as likely that the household model cannot cost, for
 * the Methodology view's "Likely but not modelled" table.
 */
export const NOT_MODELLED = [
  {
    name: "Business rates relief for pubs and live music venues",
    why: "Business rates are in the model only as an aggregate with no split by sector.",
  },
  {
    name: "“Your First Home” equity loans",
    why: "The model has no mortgages or equity loans, and the scheme is largely a financial transaction.",
  },
  {
    name: "Online marketplaces collecting VAT",
    why: "It is a compliance measure on sellers' unpaid VAT, which the survey does not record.",
  },
  {
    name: "Bank surcharge rise",
    why: "Corporation tax on banks is not in the household model.",
  },
];

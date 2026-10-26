/**
 * Anchors in the Methodology view, for the cards' "About this chart" links
 * to the detail behind them (utils/methodLink). A heading inside a folded
 * "Technical details" opens it when linked to (App.jsx). Keep each id.
 */
export const METHOD_ANCHORS = {
  publicFinances: "method-public-finances",
  byIncome: "method-by-income",
  poverty: "method-poverty-inequality",
  scatter: "method-household-scatter",
  area: "method-area",
  young: "method-young",
  personal: "method-personal",
  incomePosition: "method-income-position",
  living: "method-living",
  forecastFeed: "method-forecast-feed",
  lsNotes: "method-ls-notes",
  limitations: "method-limitations",
  glossary: "method-terms",
};

// Every age card's About this chart ends here: who counts and the age bands
export const AGE_METHOD = { anchor: METHOD_ANCHORS.young, label: "How we split results by age" };

// Household impact's "About these figures", under its results, which the
// Methodology view's Household calculation links to
export const HOUSEHOLD_ABOUT_ID = "household-about-figures";

// The by-year age cards' About this chart: how the chart is drawn
export const BY_YEAR_METHOD = { anchor: METHOD_ANCHORS.young, label: "How the by-year charts are drawn" };

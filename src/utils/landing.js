/**
 * When the page opens on its landing page: only at the bare address. A link
 * that names a view or a selection (?tab=, ?sub=, ?policies=, ?year=) or a
 * section (#young-people, #deciles) opens that instead, as it always has.
 *
 * Kept free of React so the root layout's inline script (DEEP_LINK_SCRIPT)
 * and App.jsx read the same rule.
 */

/** The query parameters that make an address a link to a view. */
export const DEEP_LINK_PARAMS = Object.freeze(["tab", "sub", "policies", "year"]);

/**
 * The hashes that make an address a link to a section: Young people
 * (YoungPeopleSection's YOUNG_PEOPLE_ANCHOR) and the income decile pair
 * (App.jsx's DECILES_ANCHOR). landing.test.js keeps them in step.
 */
export const DEEP_LINK_HASHES = Object.freeze(["#young-people", "#deciles"]);

/** Whether a page address opens the landing page. */
export function opensLanding({ search, hash }) {
  const params = new URLSearchParams(search);
  if (DEEP_LINK_PARAMS.some((key) => params.has(key))) return false;
  return !DEEP_LINK_HASHES.includes(hash);
}

/**
 * Run in <head> before the first paint: marks a link to a view
 * (html[data-deep-link]), so the server's landing page, the first render
 * for every address, stays hidden until the browser has read the address
 * and opened the view. Without it a shared link would flash the landing
 * page first.
 */
export const DEEP_LINK_SCRIPT =
  "(function(){try{" +
  "var l=window.location,p=new URLSearchParams(l.search);" +
  `if(${JSON.stringify(DEEP_LINK_PARAMS)}.some(function(k){return p.has(k)})||${JSON.stringify(DEEP_LINK_HASHES)}.indexOf(l.hash)>=0)` +
  'document.documentElement.setAttribute("data-deep-link","")' +
  "}catch(e){}})();";

const MINUS = "−";

/**
 * A box's live figure: the number, shown large, the words that say what it
 * is, and its tone ("gain" or "loss" for a change by its sign, else
 * "neutral"), which colours the number.
 * @typedef {{value: string, context: string, tone: "gain"|"loss"|"neutral"}} LandingFigure
 */

const toneOf = (rounded) => (rounded > 0 ? "gain" : rounded < 0 ? "loss" : "neutral");

/**
 * The landing page's Public finances figure: the selected measures' net
 * change in government revenue in `year`: "−£8.8bn", "change in revenue,
 * 2027-28" (£bn, one decimal, a true minus). Null when the year is not
 * fully published.
 * @returns {LandingFigure|null}
 */
export function netRevenueFigure(budgetData, year, label) {
  const value = budgetData?.find((point) => point.year === year)?.netImpact;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return {
    value: `${sign}£${Math.abs(rounded).toFixed(1)}bn`,
    context: `change in government revenue, ${label(year)}`,
    tone: toneOf(rounded),
  };
}

/**
 * An example household's change in net income: "+£88", "a year for a
 * 22-year-old renting"; "No change" when it rounds to nothing.
 * @returns {LandingFigure|null}
 */
export function householdFigure(change, who) {
  if (!Number.isFinite(change)) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return { value: "No change", context: `for ${who}`, tone: "neutral" };
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return {
    value: rounded > 0 ? `+${text}` : `${MINUS}${text}`,
    context: `a year for ${who}`,
    tone: toneOf(rounded),
  };
}

/** "9", "measures"; "1", "measure"; null for none. @returns {LandingFigure|null} */
export function measureCountFigure(count) {
  if (!count) return null;
  return { value: String(count), context: count === 1 ? "measure" : "measures", tone: "neutral" };
}

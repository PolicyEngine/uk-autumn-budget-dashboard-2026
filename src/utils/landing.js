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

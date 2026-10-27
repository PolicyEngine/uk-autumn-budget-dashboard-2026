/**
 * The past events' pages, under the site's base path: the index
 * (src/app/budgets/page.tsx) and one page per event
 * (src/app/budgets/[release]/page.tsx). Each reads only its own release's
 * files, never this Budget's.
 */
export const PAST_EVENTS_PATH = "/budgets";

/** Whether an address's path (location.pathname) is one of the past events' pages. */
export function isPastEventPath(pathname, basePath = "") {
  const root = `${basePath}${PAST_EVENTS_PATH}`;
  return pathname === root || pathname.startsWith(`${root}/`);
}

// The release a page shows, when it is not the page's own: ?budget=<id>
// (App.jsx)
export const RELEASE_PARAM = "budget";

/**
 * Whether an address is one of the past events' pages, or any page whose
 * ?budget= names a past event (`ids`, the registered past events), which
 * the dashboard then shows in place of this Budget. Neither reads this
 * Budget's files, so the head script requests none of them there.
 */
export function isPastEventAddress({ pathname, search }, ids, basePath = "") {
  return isPastEventPath(pathname, basePath) || ids.includes(new URLSearchParams(search).get(RELEASE_PARAM));
}

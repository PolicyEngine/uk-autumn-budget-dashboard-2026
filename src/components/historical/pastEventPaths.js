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

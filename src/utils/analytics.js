/**
 * Google Analytics 4, as policyengine.org's own pages send it: the same
 * property, so the dashboard's visits sit beside the site's (the page is
 * served at policyengine.org/uk/autumn-budget-2026). The layout loads gtag
 * in a production build only; in tests and `next dev` every call here does
 * nothing.
 *
 * | Event                | When                                         | Parameters |
 * | -------------------- | -------------------------------------------- | ---------- |
 * | view_opened          | A view's tab (or a link to a view) opens it   | view, sub |
 * | household_calculated | Calculate on the Household calculator        | household (a preset's id or "yours"), year, policy_count |
 * | report_downloaded    | A link that downloads a file is clicked      | file (its name) |
 * | policy_brief_opened  | A link to one of our posts is clicked        | slug, placement (policies, methodology or other) |
 *
 * No event carries a household's answers or any figure from its result.
 */

export const GA_MEASUREMENT_ID = "G-2YHG89FY0N";

/** The inline script that starts gtag once its library has loaded. */
export const GA_INIT_SCRIPT = [
  "window.dataLayer = window.dataLayer || [];",
  "function gtag(){dataLayer.push(arguments);}",
  "window.gtag = gtag;",
  "gtag('js', new Date());",
  `gtag('config', '${GA_MEASUREMENT_ID}');`,
].join("\n");

/** Send one event, if gtag is on the page. */
export function trackEvent(name, params) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", name, params);
  }
}

const RESEARCH_PATH = /\/uk\/research\/([a-z0-9-]+)/;

/** The event, if any, a click on this link sends. */
export function linkEvent(link) {
  const href = link.getAttribute("href") || "";
  if (link.hasAttribute("download")) {
    return ["report_downloaded", { file: href.split("/").pop() }];
  }
  const post = href.match(RESEARCH_PATH);
  if (post) {
    const placement = link.closest(".policy-card") ? "policies" : link.closest(".methodology-tab") ? "methodology" : "other";
    return ["policy_brief_opened", { slug: post[1], placement }];
  }
  return null;
}

/**
 * Listen for clicks on the page's links and send their events. Returns the
 * function that stops listening.
 */
export function trackLinkClicks(root = document) {
  const onClick = (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const found = link && linkEvent(link);
    if (found) trackEvent(...found);
  };
  root.addEventListener("click", onClick, true);
  return () => root.removeEventListener("click", onClick, true);
}

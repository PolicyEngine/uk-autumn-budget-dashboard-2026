/**
 * Google Analytics 4, as policyengine.org's own pages send it: the same
 * property, so the dashboard's visits sit beside the site's (the page is
 * served at policyengine.org/uk/autumn-budget-2026). The layout loads gtag
 * in a production build only; in tests and `next dev` every call here does
 * nothing.
 *
 * Every event, the page view included, carries `tool_name` (TOOL_NAME), as
 * every PolicyEngine tool's does: Teamverse's Tools performance report
 * groups the property's events by it, so without it the dashboard's visits
 * and actions don't show there.
 *
 * | Event                | When                                         | Parameters |
 * | -------------------- | -------------------------------------------- | ---------- |
 * | view_opened          | A view's tab (or a link to a view) opens it   | view, sub |
 * | household_calculated | Calculate on the Household calculator        | household (a preset's id or "yours"), year, policy_count |
 * | report_downloaded    | A link that downloads a file is clicked      | file (its name) |
 * | policy_brief_opened  | A link to one of our posts is clicked        | slug, placement (policies, methodology or other) |
 * | outbound_click       | A link to another site is clicked            | url, target_hostname |
 * | scroll_depth         | The page is first scrolled 25/50/75/100% down | percent |
 * | time_on_tool         | The tab is still open and visible after 30/60/120/300 s | seconds |
 *
 * No event carries a household's answers or any figure from its result.
 */

export const GA_MEASUREMENT_ID = "G-2YHG89FY0N";

/** The dashboard's name in the property's tool_name dimension. */
export const TOOL_NAME = "autumn-budget-2026";

/** The inline script that starts gtag once its library has loaded. */
export const GA_INIT_SCRIPT = [
  "window.dataLayer = window.dataLayer || [];",
  "function gtag(){dataLayer.push(arguments);}",
  "window.gtag = gtag;",
  "gtag('js', new Date());",
  `gtag('config', '${GA_MEASUREMENT_ID}', { tool_name: '${TOOL_NAME}' });`,
].join("\n");

/** Send one event, if gtag is on the page. */
export function trackEvent(name, params) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", name, { ...params, tool_name: TOOL_NAME });
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
  let target;
  try {
    target = new URL(link.href, window.location.href);
  } catch {
    return null;
  }
  if (/^https?:$/.test(target.protocol) && target.hostname !== window.location.hostname) {
    return ["outbound_click", { url: target.href, target_hostname: target.hostname }];
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

const SCROLL_MARKS = [25, 50, 75, 100];
const TIME_MARKS = [30, 60, 120, 300];

/**
 * Send the engagement events every PolicyEngine tool sends: how far down
 * the page a visitor first scrolls, and how long the tab stays open and
 * visible. Returns the function that stops them.
 */
export function trackEngagement() {
  const reached = new Set();
  const onScroll = () => {
    const height = document.documentElement.scrollHeight - window.innerHeight;
    if (height <= 0) return;
    const percent = Math.floor((window.scrollY / height) * 100);
    for (const mark of SCROLL_MARKS) {
      if (percent >= mark && !reached.has(mark)) {
        reached.add(mark);
        trackEvent("scroll_depth", { percent: mark });
      }
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const timers = TIME_MARKS.map((seconds) =>
    setTimeout(() => {
      if (document.visibilityState !== "hidden") trackEvent("time_on_tool", { seconds });
    }, seconds * 1000),
  );
  return () => {
    window.removeEventListener("scroll", onScroll);
    timers.forEach(clearTimeout);
  };
}

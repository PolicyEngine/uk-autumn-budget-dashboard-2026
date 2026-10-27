/**
 * Scrolling the page to a heading, card or tab row so it lands below the
 * sticky bars: the site nav (when shown), the title band, the view tabs
 * and a view's sub-tab band. Their heights change as they stick (the tab
 * rows go compact), with the window width, and as the site nav slides in
 * and out, so the offset is measured from the bars themselves each time,
 * never read from a CSS variable that may be stale.
 *
 * A scroll made here is not the reader scrolling: App.jsx's site-nav logic
 * asks isProgrammaticScroll() and does not slide the nav in on its way up
 * (it would cover the target it was lined up under). Where the target
 * cannot clear the bars with the nav in (the page's top: nothing above
 * scrollY 0 to scroll to), the nav goes.
 */

// The ui-kit shell's sticky site nav (App.jsx SHELL_STICKY_NAV_SELECTOR)
const SITE_NAV = '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';
const BARS = [SITE_NAV, ".title-row", ".view-tabs-bar", ".sub-tabs-band"];

/** The gap between the bars and a target scrolled to below them (px). */
export const STICKY_GAP = 16;

// The scroll in flight from here: where it goes, and until when it counts
let pending = null;
const PENDING_MS = 2000;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "smooth" unless the reader asks for reduced motion. */
export const smoothUnlessReduced = () => (reducedMotion() ? "auto" : "smooth");

/**
 * How far down the window the sticky bars reach (px from its top): the
 * lowest bottom of those shown. With `above`, only the bars before that
 * element in the page count (for a sentinel that sits above a bar).
 */
export function stickyBottom({ above } = {}) {
  if (typeof document === "undefined") return 0;
  let bottom = 0;
  for (const selector of BARS) {
    for (const bar of document.querySelectorAll(selector)) {
      if (above && !(bar.compareDocumentPosition(above) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (above && bar.contains(above)) continue;
      const style = getComputedStyle(bar);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = bar.getBoundingClientRect();
      if (rect.height <= 0) continue;
      bottom = Math.max(bottom, rect.bottom);
    }
  }
  return bottom;
}

/**
 * Whether a scroll event at `y` belongs to a scroll made here. Clears the
 * mark once the scroll arrives or its time is up.
 */
export function isProgrammaticScroll(y = typeof window === "undefined" ? 0 : window.scrollY) {
  if (!pending) return false;
  if (now() > pending.until) {
    pending = null;
    return false;
  }
  if (Math.abs(y - pending.top) <= 1) pending.until = Math.min(pending.until, now() + 100);
  return true;
}

const siteNavShown = () => document.documentElement.hasAttribute("data-site-nav-shown");

/**
 * Where the page has to be scrolled to for `target` to sit `gap` px below
 * the bars (unclamped: below 0 it cannot get there).
 */
export function scrollTopFor(target, { gap = STICKY_GAP, above } = {}) {
  return target.getBoundingClientRect().top + window.scrollY - stickyBottom({ above }) - gap;
}

/** Scroll the page to `top`, marked as not the reader's own scroll. */
export function scrollPageTo(top, behavior = "auto") {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamped = Math.round(Math.min(Math.max(0, top), max || Math.max(0, top)));
  if (Math.abs(clamped - window.scrollY) < 1) return false;
  pending = { top: clamped, until: now() + PENDING_MS };
  window.scrollTo({ top: clamped, behavior });
  return true;
}

// The views' section headings: a page-made landing never leaves one under
// the bars
const HEADINGS = ".section-heading, .method-section-heading";
// Within this of the page's top (px), a heading is cleared from the top
const NEAR_TOP = 80;

/**
 * `top` moved up, if needed, so that at it no shown section heading is
 * under the sticky bars (or within 8px of them): the first such heading
 * then sits STICKY_GAP px below them.
 */
export function clearOfHeadings(top) {
  if (typeof document === "undefined") return top;
  const bottom = stickyBottom();
  const y = window.scrollY;
  const headings = [];
  for (const heading of document.querySelectorAll(HEADINGS)) {
    if (!heading.offsetParent || heading.closest("[hidden]")) continue;
    const rect = heading.getBoundingClientRect();
    if (rect.height > 0) headings.push([rect.top + y, rect.bottom + y]);
  }
  const from = top;
  // Moving up can bring an earlier heading under the bars: look again
  for (let round = 0; round < 4; round += 1) {
    const hit = headings.find(([start, end]) => end > top && start < top + bottom + 8);
    if (!hit) break;
    top = hit[0] - bottom - STICKY_GAP;
  }
  // Near the page's top the tab rows are about to unstick (and grow), so a
  // place just above where they stick never settles: the top itself, laid
  // out with every heading clear, is where it goes
  if (top < from && top < NEAR_TOP) top = 0;
  return top;
}

/**
 * If a shown section heading is under the sticky bars, scroll up so it
 * clears them. For the end of a scroll the page made: a view's restored
 * position, the first load, back/forward.
 */
export function clearHeadings() {
  if (typeof window === "undefined") return false;
  const top = clearOfHeadings(window.scrollY);
  return top < window.scrollY - 1 ? scrollPageTo(top) : false;
}

/**
 * Once the page has stopped scrolling (or after 1.5s), run `then`; if it
 * scrolls the page (returns true), wait again, up to `rounds` times.
 */
function afterSettle(then, rounds = 3) {
  if (typeof requestAnimationFrame !== "function") return;
  let settled = 0;
  let lastY = -1;
  let round = 0;
  let started = now();
  const settle = () => {
    const y = window.scrollY;
    settled = y === lastY ? settled + 1 : 0;
    lastY = y;
    if (settled < 2 && now() - started < 1500) {
      requestAnimationFrame(settle);
      return;
    }
    round += 1;
    if (then() && round < rounds) {
      settled = 0;
      started = now();
      requestAnimationFrame(settle);
    }
  };
  requestAnimationFrame(settle);
}

/**
 * Scroll the page to `top` (a view's remembered place), then make sure no
 * section heading is left under the bars.
 */
export function landAt(top) {
  scrollPageTo(top);
  afterSettle(clearHeadings);
}

/** After a load or history move: no section heading under the bars. */
export function settleHeadings() {
  afterSettle(clearHeadings);
}

/**
 * Scroll so `target` sits `gap` px below the sticky bars, measured now and
 * again once the scroll has settled (the bars change height as they stick).
 * `onlyUp`: only if the target has gone up under the bars. `above`: count
 * only the bars above the target (a sentinel lined up under them, gap 0).
 */
export function scrollBelowBars(target, { behavior = "auto", gap = STICKY_GAP, onlyUp = false, above } = {}) {
  if (typeof window === "undefined" || !target?.getBoundingClientRect) return;
  const options = { gap, above: above ? target : undefined };
  const line = (how) => {
    let top = scrollTopFor(target, options);
    // At the page's top the shown site nav would cover the target, with
    // nothing above to scroll to: it goes
    if (top < -1 && siteNavShown()) {
      document.documentElement.removeAttribute("data-site-nav-shown");
      top = scrollTopFor(target, options);
    }
    // Never leaving a section heading under the bars on the way
    top = clearOfHeadings(top);
    if (onlyUp && top >= window.scrollY) return false;
    return scrollPageTo(top, how);
  };
  if (!line(behavior)) {
    afterSettle(clearHeadings);
    return;
  }
  // Line it up again once the scroll has stopped (tab rows going compact,
  // the nav sliding, and content loading above can all move it), then
  // make sure no section heading is left under the bars
  let lined = 0;
  afterSettle(() => {
    if (!target.isConnected) return false;
    if (lined < 2 && line("auto")) {
      lined += 1;
      return true;
    }
    return clearHeadings();
  }, 5);
}

/** Test hook: forget a scroll in flight. */
export function resetPageScroll() {
  pending = null;
}

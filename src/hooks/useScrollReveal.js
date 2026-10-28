import { useEffect } from "react";

/**
 * What appears with the scroll-reveal animation: section headings and the
 * cards under them on Population impact, Household calculator and Living
 * standards (not the band, the tabs or the intro). Methodology (#127) can
 * use <Reveal> once both are in.
 */
export const REVEAL_SELECTOR = [
  ".tab-panel:not(#panel-methodology) .section-heading",
  ".tab-panel:not(#panel-methodology) .charts-grid > *",
  ".tab-panel:not(#panel-methodology) .report-section.hero-chart",
  ".tab-panel:not(#panel-methodology) #policy-details",
  ".tab-panel:not(#panel-methodology) .household-form",
  ".tab-panel:not(#panel-methodology) .result-card",
  ".tab-panel:not(#panel-methodology) .forecast-tiles > *",
  ".tab-panel:not(#panel-methodology) .ls-card",
].join(", ");

// Cards side by side come in one after another
const STAGGER_MS = 70;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Each matching element below the fold fades and rises into place the
 * first time a sixth of it scrolls into view, once. Elements already in
 * view when they appear are left as they are, so nothing flashes; with no
 * IntersectionObserver or under reduced motion nothing is hidden at all.
 * Elements added later (data arriving, a tab opened) are picked up as they
 * mount; those in a hidden tab reveal when the tab is shown.
 *
 * @param {{current: Element|null}} rootRef
 */
export default function useScrollReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined" || reducedMotion()) {
      return undefined;
    }
    const seen = new WeakSet();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    const scan = () => {
      for (const element of root.querySelectorAll(REVEAL_SELECTOR)) {
        if (seen.has(element)) continue;
        seen.add(element);
        const box = element.getBoundingClientRect();
        const shown = box.width > 0 && box.height > 0;
        // Already on screen: leave it be
        if (shown && box.top < window.innerHeight && box.bottom > 0) continue;
        const parent = element.parentElement;
        const index = parent?.classList.contains("charts-grid")
          ? [...parent.children].indexOf(element)
          : 0;
        element.style.setProperty("--reveal-delay", `${index * STAGGER_MS}ms`);
        element.classList.add("reveal");
        observer.observe(element);
      }
    };
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [rootRef]);
}

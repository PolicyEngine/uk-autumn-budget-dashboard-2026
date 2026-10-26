import { useEffect, useLayoutEffect, useRef } from "react";
import { MOTION_BASE_MS, MOTION_EASE_OUT, prefersReducedMotion } from "../utils/chartMotion";

/**
 * A card's content that changes with a view or option ("By age group" or
 * "By single year of age", chart or table, map or rankings): when
 * `swapKey` changes, the new content fades in with a 6px rise, and the
 * wrapper's height eases from the old content's to the new one's, so the
 * page below does not jump. Key it on the view, never on the data (a year
 * or the measures): a chart whose data change keeps its own Recharts
 * tween. Nothing moves on first render or with prefers-reduced-motion.
 * Timed with setTimeout, not transitionend, which a 0ms transition never
 * fires.
 *
 * @param {Object} props
 * @param {string} props.swapKey - The view or option shown
 * @param {string} [props.className]
 * @param {{current: HTMLElement|null}|((node: HTMLElement|null) => void)} [props.ref] -
 *   The wrapper (a card's chart-plot, which its Download reads)
 * @param {React.ReactNode} props.children
 */
export default function SwapTransition({ swapKey, className, ref, children }) {
  const outerRef = useRef(null);
  const setOuter = (node) => {
    outerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  const innerRef = useRef(null);
  const shownKey = useRef(swapKey);
  // The content's height as last laid out, before a swap replaces it
  const height = useRef(null);
  const animating = useRef(false);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return undefined;
    height.current = inner.offsetHeight;
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (!animating.current) height.current = inner.offsetHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (swapKey === shownKey.current) return undefined;
    shownKey.current = swapKey;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || prefersReducedMotion()) {
      if (inner) height.current = inner.offsetHeight;
      return undefined;
    }
    const from = height.current;
    const to = inner.offsetHeight;
    // The new content rises in (restart the animation on every swap)
    inner.classList.remove("swap-in");
    void inner.offsetWidth;
    inner.classList.add("swap-in");
    animating.current = true;
    if (from && to && Math.abs(from - to) > 1) {
      outer.style.height = `${from}px`;
      outer.style.overflow = "hidden";
      void outer.offsetHeight;
      outer.style.transition = `height ${MOTION_BASE_MS}ms ${MOTION_EASE_OUT}`;
      outer.style.height = `${to}px`;
    }
    const timer = setTimeout(() => {
      outer.style.height = "";
      outer.style.overflow = "";
      outer.style.transition = "";
      animating.current = false;
      height.current = inner.offsetHeight;
    }, MOTION_BASE_MS);
    return () => {
      clearTimeout(timer);
      outer.style.height = "";
      outer.style.overflow = "";
      outer.style.transition = "";
      animating.current = false;
    };
  }, [swapKey]);

  return (
    <div ref={setOuter} className={`swap-transition${className ? ` ${className}` : ""}`}>
      <div ref={innerRef} className="swap-transition-inner">
        {children}
      </div>
    </div>
  );
}

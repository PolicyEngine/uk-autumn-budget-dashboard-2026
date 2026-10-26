import { useEffect, useRef, useState } from "react";

/**
 * Measure an element's width, and keep measuring it as it resizes. Returns
 * [ref, width]; width is 0 until the element is measured.
 */
export default function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // A hidden view (display: none) measures 0: keep the last width, so the
    // chart is laid out as before when the view is shown again
    const update = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

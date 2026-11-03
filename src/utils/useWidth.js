import { useLayoutEffect, useState } from "react";

/** A plot's width before it is measured (and in tests, with no layout). */
export const DEFAULT_WIDTH = 520;

/** The width of an element, followed as it changes. */
export function useWidth(ref, initial = DEFAULT_WIDTH) {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

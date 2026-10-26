import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * The chosen option's thumb in a segmented control, which slides to a new
 * choice (the sub-tabs' sliding pill, for any row of options, wrapped
 * rows included): the chosen item's box inside the container, measured
 * after layout and again when anything resizes. `ready` turns on once the
 * first place is known, so the thumb never slides in from the corner; the
 * slide itself is CSS (.segment-thumb.is-ready, --motion-slide), off with
 * prefers-reduced-motion.
 *
 * @param {string} value - The chosen option
 * @returns {{ containerRef: {current: HTMLElement|null},
 *   itemRef: (value: string) => (node: HTMLElement|null) => void,
 *   thumbStyle: Object, ready: boolean }}
 */
export default function useSegmentThumb(value) {
  const containerRef = useRef(null);
  const items = useRef({});
  const [place, setPlace] = useState({ x: 0, y: 0, width: 0, height: 0, ready: false });

  const itemRef = useCallback(
    (key) => (node) => {
      if (node) items.current[key] = node;
      else delete items.current[key];
    },
    [],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = () => {
      const node = items.current[value];
      if (!node) {
        setPlace((was) => (was.width === 0 ? was : { ...was, width: 0, height: 0 }));
        return;
      }
      const next = { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight };
      setPlace((was) =>
        was.x === next.x && was.y === next.y && was.width === next.width && was.height === next.height && was.ready
          ? was
          : { ...next, ready: was.ready || next.width > 0 },
      );
    };
    measure();
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const node of Object.values(items.current)) observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  return {
    containerRef,
    itemRef,
    ready: place.ready && place.width > 0,
    thumbStyle: {
      width: place.width,
      height: place.height,
      transform: `translate(${place.x}px, ${place.y}px)`,
    },
  };
}

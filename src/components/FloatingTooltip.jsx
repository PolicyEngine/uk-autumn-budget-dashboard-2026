import { useLayoutEffect, useRef, useState } from "react";
import ChartTooltip from "./ChartTooltip";
import "./ChartTooltip.css";

// Away from the hovered point, as TOOLTIP_PROPS.offset
const OFFSET = 12;

/**
 * The hovered or focused point of a hand-drawn chart (one not drawn by
 * Recharts): where it is, relative to the plot, and what its tooltip says.
 * Cleared whenever `resetKey` changes (the year, or the data), so a tooltip
 * never shows the last year's values while the year pill plays.
 *
 * Point handlers take the event: a pointer's position, or for keyboard
 * focus the focused element's centre.
 */
export function useFloatingTooltip(containerRef, resetKey) {
  const [state, setTip] = useState(null);
  // A tooltip set under another key (the last year) is not shown
  const tip = state && state.resetKey === resetKey ? state : null;

  const at = (event) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return null;
    if (event.type === "focus" || event.clientX === undefined) {
      const target = event.currentTarget.getBoundingClientRect();
      return {
        x: target.left + target.width / 2 - box.left,
        y: target.top + target.height / 2 - box.top,
      };
    }
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  /** Handlers for one point: show its tooltip on hover or focus. */
  const handlers = (key, content) => ({
    onMouseEnter: (event) => {
      const point = at(event);
      if (point) setTip({ key, content, resetKey, ...point });
    },
    onMouseMove: (event) => {
      const point = at(event);
      if (point) setTip({ key, content, resetKey, ...point });
    },
    onMouseLeave: () => setTip(null),
    onFocus: (event) => {
      const point = at(event);
      if (point) setTip({ key, content, resetKey, ...point });
    },
    onBlur: () => setTip(null),
  });

  return { tip, handlers, hide: () => setTip(null) };
}

/**
 * The tooltip of a hand-drawn chart, in the ChartTooltip style, inside its
 * plot (the nearest positioned ancestor): beside the point, right by
 * default and flipped left near the right edge, below it and flipped
 * above near the bottom, and never past the plot's edges, so on a phone it
 * stays inside the card.
 */
export function FloatingTooltip({ tip }) {
  const ref = useRef(null);
  const [place, setPlace] = useState(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !tip) {
      setPlace(null);
      return;
    }
    const parent = node.offsetParent;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const maxX = Math.max(0, (parent?.clientWidth ?? width) - width);
    const maxY = Math.max(0, (parent?.clientHeight ?? height) - height);
    let left = tip.x + OFFSET;
    if (left > maxX) left = tip.x - OFFSET - width;
    let top = tip.y + OFFSET;
    if (top > maxY) top = tip.y - OFFSET - height;
    setPlace({
      left: Math.min(Math.max(0, left), maxX),
      top: Math.min(Math.max(0, top), maxY),
    });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className="floating-tooltip"
      role="tooltip"
      style={{
        left: place?.left ?? tip.x + OFFSET,
        top: place?.top ?? tip.y + OFFSET,
        visibility: place ? "visible" : "hidden",
      }}
    >
      {tip.content}
    </div>
  );
}

/**
 * A tooltip's content from rows of already formatted values: the shared
 * ChartTooltip with a heading (what the point is, and the year) and one row
 * per value.
 *
 * @param {string} label - e.g. "Fuel duty rises deferred, 2027-28"
 * @param {Array<{key: string, name: string, text: string, color: string}>} rows
 */
export function TooltipRows({ label, rows }) {
  return (
    <ChartTooltip
      active
      label={label}
      grouped={false}
      showZero
      format={String}
      payload={rows.map((row) => ({
        dataKey: row.key,
        name: row.name,
        value: 0,
        text: row.text,
        color: row.color,
      }))}
    />
  );
}

import { useEffect, useState } from "react";
import ChartTooltip from "./ChartTooltip";
import { ViewportBox, pointIn } from "./ViewportTooltip";
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
    // A tap (touch has no hover): open this point's tooltip, or close it
    // when it is already open
    onClick: (event) => {
      // A mouse already shows it on hover; a click there changes nothing
      if (event.nativeEvent?.pointerType === "mouse") return;
      const point = at(event);
      if (!point) return;
      setTip((current) => (current && current.key === key ? null : { key, content, resetKey, ...point }));
    },
  });

  // A tap anywhere outside the plot closes an open tooltip
  useEffect(() => {
    if (!tip) return undefined;
    const close = (event) => {
      if (!containerRef.current?.contains(event.target)) setTip(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [tip, containerRef]);

  return { tip, handlers, hide: () => setTip(null) };
}

/**
 * The tooltip of a hand-drawn chart, in the ChartTooltip style, beside the
 * point (tip.x, tip.y from its plot, the nearest positioned ancestor) and
 * drawn in the window by ViewportBox: flipped left or above near an edge
 * and kept wholly inside the window, clear of the sticky band.
 */
export function FloatingTooltip({ tip }) {
  if (!tip) return null;
  return (
    <ViewportBox locate={(probe) => pointIn(probe, tip.x, tip.y)} offset={OFFSET}>
      <div className="floating-tooltip">{tip.content}</div>
    </ViewportBox>
  );
}

/**
 * A tooltip's content from rows of already formatted values: the shared
 * ChartTooltip with a heading (what the point is, and the year) and one row
 * per value.
 *
 * @param {string} label - e.g. "Fuel duty rises deferred, 2027-28"
 * @param {Array<{key: string, name: string, text: string, color: string}>} rows
 * @param {string|string[]} [note] - A line under the rows (e.g. why a
 *   policy's estimate differs from the official costing), several in
 *   order, or none
 */
export function TooltipRows({ label, rows, note }) {
  return (
    <ChartTooltip
      active
      label={label}
      note={note ? () => note : undefined}
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

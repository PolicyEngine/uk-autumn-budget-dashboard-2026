import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip as RechartsTooltip } from "recharts";
import { TOOLTIP_MARGIN, placeTooltip, stickyInset } from "../utils/tooltipPlacement";
import "./ChartTooltip.css";

// Lists that go to two columns when the tooltip is taller than the window
const COMPACTABLE = ".ls-year-panel-list, .chart-tooltip-section";
// The hovered row, kept in view when the tooltip scrolls inside
const ACTIVE_ROW = ".is-hovered, [data-active='true']";

/** Measure the box and place it (placeTooltip), compacting a tall list. */
function placeBox(box, probe, locate, offset) {
  if (!box || !probe) return;
  const anchor = locate(probe);
  const content = box.firstElementChild;
  if (!anchor || !content) {
    box.style.visibility = "hidden";
    return;
  }
  box.classList.remove("is-compact");
  box.style.left = "0px";
  box.style.top = "0px";
  box.style.maxWidth = "";
  content.style.maxHeight = "";
  content.style.overflowY = "";
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;
  const topInset = stickyInset(probe);
  const room = viewportHeight - topInset - 2 * TOOLTIP_MARGIN;
  let rect = box.getBoundingClientRect();
  if (rect.height > room && content.querySelector(COMPACTABLE)) {
    box.classList.add("is-compact");
    rect = box.getBoundingClientRect();
  }
  const place = placeTooltip({
    x: anchor.x,
    y: anchor.y,
    width: rect.width,
    height: rect.height,
    viewportWidth,
    viewportHeight,
    topInset,
    offset,
  });
  box.style.left = `${place.left}px`;
  box.style.top = `${place.top}px`;
  if (place.maxWidth != null) box.style.maxWidth = `${place.maxWidth}px`;
  if (place.maxHeight != null) {
    content.style.maxHeight = `${place.maxHeight}px`;
    content.style.overflowY = "auto";
    const row = content.querySelector(ACTIVE_ROW);
    if (row) {
      const rowTop = row.offsetTop - content.offsetTop;
      if (rowTop < content.scrollTop || rowTop + row.offsetHeight > content.scrollTop + place.maxHeight) {
        content.scrollTop = Math.max(0, rowTop - place.maxHeight / 2);
      }
    }
  }
  box.style.visibility = "visible";
}

/**
 * A hover tooltip drawn in the window (position: fixed, in a portal), so
 * no card, plot or the window's foot cuts it off: placed by placeTooltip
 * beside its anchor, flipped and clamped inside the window clear of the
 * sticky band; a tall list goes to two columns, and if it still does not
 * fit it scrolls inside with the hovered row in view. Re-placed on scroll
 * and resize.
 *
 * @param {Object} props
 * @param {(probe: HTMLElement) => ({x: number, y: number}|null)} props.locate -
 *   The anchor in window px, from a probe at the tooltip's place in the tree
 * @param {number} [props.offset] - Gap from the anchor (0: pinned corner)
 */
export function ViewportBox({ locate, offset = 12, children }) {
  const probeRef = useRef(null);
  const boxRef = useRef(null);
  const argsRef = useRef({ locate, offset });
  const [host, setHost] = useState(null);

  useLayoutEffect(() => {
    setHost(probeRef.current?.closest(".app") ?? document.body);
  }, []);

  // After every render: the content or the anchor may have changed
  useLayoutEffect(() => {
    argsRef.current = { locate, offset };
    placeBox(boxRef.current, probeRef.current, locate, offset);
  });

  useEffect(() => {
    const replace = () => placeBox(boxRef.current, probeRef.current, argsRef.current.locate, argsRef.current.offset);
    window.addEventListener("scroll", replace, true);
    window.addEventListener("resize", replace);
    return () => {
      window.removeEventListener("scroll", replace, true);
      window.removeEventListener("resize", replace);
    };
  }, []);

  return (
    <>
      <span ref={probeRef} className="viewport-tooltip-probe" aria-hidden="true" />
      {host &&
        createPortal(
          <div ref={boxRef} className="viewport-tooltip" role="tooltip">
            {children}
          </div>,
          host,
        )}
    </>
  );
}

/**
 * A point (x, y) of the plot holding the probe (its nearest positioned
 * ancestor: the probe sits at its top-left corner), in window px.
 */
export function pointIn(probe, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const origin = probe.getBoundingClientRect();
  return { x: origin.left + x, y: origin.top + y };
}

/**
 * A Recharts tooltip's content, drawn by ViewportBox: anchored at the
 * hovered point (Recharts' coordinate) or, where the chart pins it with
 * `position`, with its top-left corner there.
 */
function ViewportContent({ inner, ...props }) {
  const { active, coordinate, position, offset } = props;
  if (!active) return null;
  const rendered = isValidElement(inner)
    ? cloneElement(inner, props)
    : typeof inner === "function"
      ? inner(props)
      : null;
  if (!rendered) return null;
  const pinned = position && (Number.isFinite(position.x) || Number.isFinite(position.y));
  const locate = (probe) => {
    const plot = probe.closest(".recharts-wrapper");
    if (!plot || !coordinate) return null;
    const box = plot.getBoundingClientRect();
    const x = pinned && Number.isFinite(position.x) ? position.x : coordinate.x;
    const y = pinned && Number.isFinite(position.y) ? position.y : coordinate.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: box.left + x, y: box.top + y };
  };
  return (
    <ViewportBox locate={locate} offset={pinned ? 0 : offset ?? 12}>
      {rendered}
    </ViewportBox>
  );
}

/**
 * Recharts' Tooltip with its content drawn in the window (ViewportBox), so
 * it is never cut off by the plot, the card or the window's edge. A drop-in
 * for `import { Tooltip } from "recharts"`: the charts find it by its
 * displayName, and every prop passes through.
 */
export function Tooltip(props) {
  const { content } = props;
  return <RechartsTooltip {...props} content={<ViewportContent inner={content} />} />;
}
Tooltip.displayName = "Tooltip";

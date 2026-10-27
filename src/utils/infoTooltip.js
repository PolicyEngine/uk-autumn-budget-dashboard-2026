import { stickyInset } from "./tooltipPlacement";

/**
 * Keep an "i" tooltip (.info-icon-wrapper > .info-tooltip) inside the
 * viewport. The tooltip is centred over its icon in CSS; an icon near the
 * screen's edge (a phone's left form column) would push it off screen, so
 * just before it shows, it is shifted sideways by --tip-shift to sit at
 * least EDGE px from either edge. Its arrow moves back by the same amount,
 * so it still points at the icon.
 */
export const EDGE = 16;

/** The shift (px) that brings [left, right] inside [EDGE, width - EDGE]. */
export function tooltipShift(left, right, viewportWidth, edge = EDGE) {
  if (left < edge) return edge - left;
  if (right > viewportWidth - edge) return Math.max(edge - left, viewportWidth - edge - right);
  return 0;
}

export function clampInfoTooltip(wrapper) {
  const tip = wrapper?.querySelector?.(".info-tooltip");
  if (!tip) return;
  // Measured at its centred place (hidden tooltips still have a box)
  tip.style.setProperty("--tip-shift", "0px");
  const rect = tip.getBoundingClientRect();
  const width = document.documentElement.clientWidth || window.innerWidth;
  tip.style.setProperty("--tip-shift", `${tooltipShift(rect.left, rect.right, width)}px`);
  // Above its icon by default; below it where the sticky band (or the
  // window's top) would cover it
  wrapper.classList.remove("info-tooltip-below");
  const top = tip.getBoundingClientRect().top;
  if (top < stickyInset(wrapper) + EDGE / 2) wrapper.classList.add("info-tooltip-below");
}

/**
 * Clamp every info tooltip as it is about to show (hover, or focus from a
 * tap or the keyboard). Returns the cleanup.
 */
export function installInfoTooltipClamp(doc = document) {
  const handle = (event) => {
    const wrapper = event.target?.closest?.(".info-icon-wrapper");
    if (wrapper) clampInfoTooltip(wrapper);
  };
  doc.addEventListener("pointerover", handle);
  doc.addEventListener("focusin", handle);
  return () => {
    doc.removeEventListener("pointerover", handle);
    doc.removeEventListener("focusin", handle);
  };
}

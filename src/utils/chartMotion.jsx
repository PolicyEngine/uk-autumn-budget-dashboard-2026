import { CHART_COLOURS } from "./chartTheme";
/**
 * How the Recharts series move when the data change (a year change, or the
 * year pill's Play): they tween from the old values to the new ones over
 * CHART_MOTION_MS, eased in and out, rather than redraw from zero. With
 * prefers-reduced-motion they jump straight to the new values.
 */
export const CHART_MOTION_MS = 850;

/** Whether the reader asked for reduced motion (false on the server). */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Props for a Recharts Bar, Line or Area. */
export function chartMotion() {
  return {
    isAnimationActive: !prefersReducedMotion(),
    animationBegin: 0,
    animationDuration: CHART_MOTION_MS,
    animationEasing: "ease-in-out",
  };
}

/**
 * A net-change dot (black, white ring) for a Recharts Scatter's shape.
 * Not a Line's dot: a Line hides its dots while it animates.
 */
export function netDot({ cx, cy }) {
  if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) {
    return null;
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={CHART_COLOURS.net} stroke={CHART_COLOURS.surface} strokeWidth={1.5} />;
}

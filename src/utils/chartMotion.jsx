import { CHART_COLOURS } from "./chartTheme";
/**
 * How the charts move when the data change (a year, the measures, an
 * option, or the year pill's Play): Recharts series tween from the old
 * values to the new ones over CHART_MOTION_MS, eased out, rather than
 * redraw from zero; the custom SVG charts (the year band, the map's fills)
 * take the same duration and curve. The JS mirror of --motion-chart and
 * --ease-out in globals.css (the dashboard's motion tokens). With
 * prefers-reduced-motion they jump straight to the new values.
 */
export const CHART_MOTION_MS = 300;

/** --motion-fast, for a popover or menu timed from JS */
export const MOTION_FAST_MS = 150;

/** --motion-base, for a content swap or disclosure timed from JS */
export const MOTION_BASE_MS = 220;

/** --ease-out, for a CSS transition set from JS */
export const MOTION_EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

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
    animationEasing: "ease-out",
  };
}

/**
 * An inline CSS transition for SVG or HTML chart parts that move with the
 * series ("transform", "width"): CHART_MOTION_MS, eased out; none with
 * prefers-reduced-motion.
 *
 * @param {...string} properties
 * @returns {string|undefined}
 */
export function chartTransition(...properties) {
  if (prefersReducedMotion()) return undefined;
  return properties.map((property) => `${property} ${CHART_MOTION_MS}ms ${MOTION_EASE_OUT}`).join(", ");
}

/**
 * A net-change dot (black, white ring) for a Recharts Scatter's shape.
 * Not a Line's dot: a Line hides its dots while it animates.
 */
export function netDot({ cx, cy }) {
  if (![cx, cy].every(Number.isFinite)) {
    return null;
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={CHART_COLOURS.net} stroke={CHART_COLOURS.surface} strokeWidth={1.5} />;
}

/**
 * netDot with a name: Recharts wraps each Scatter point in a g with
 * role="img", which needs a text alternative (WCAG 1.1.1), so the dot
 * carries a <title> saying its value, from `describe(row)`.
 *
 * @param {(row: Object) => string} describe - The point's row to its words
 * @returns {(props: Object) => JSX.Element|null}
 */
export function netDotTitled(describe) {
  return function NetDot(props) {
    const dot = netDot(props);
    if (!dot) return null;
    // No pointer events: the title would also show as the browser's own
    // tooltip over the chart's; the dots have no tooltip of their own
    return (
      <>
        <title>{describe(props.payload ?? {})}</title>
        <g style={{ pointerEvents: "none" }}>{dot}</g>
      </>
    );
  };
}

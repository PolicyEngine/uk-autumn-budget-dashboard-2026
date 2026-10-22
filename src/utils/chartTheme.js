/**
 * Shared presentation settings for the dashboard's Recharts charts.
 *
 * Everything here is visual: grid, ticks, margins and legend layout. It never
 * touches the data a chart plots.
 */
import { useEffect, useState } from "react";

// At or below this width (the page's phone breakpoint) a chart drops its rotated y-axis title, tightens its
// margins and puts the PolicyEngine logo under the legend, not beside it.
export const NARROW_QUERY = "(max-width: 768px)";

export function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

// Light horizontal gridlines only.
export const GRID_PROPS = {
  vertical: false,
  stroke: "#E5E7EB",
  strokeDasharray: "0",
};

export const TICK_STYLE = { fontSize: 12, fill: "#6B7280" };
export const AXIS_LINE = { stroke: "#D1D5DB" };

export const AXIS_TITLE_STYLE = {
  textAnchor: "middle",
  fill: "#4B5563",
  fontSize: 12,
  fontWeight: 500,
};

/**
 * Chart margins. On a phone the y-axis title is dropped (the chart's lead
 * sentence names the unit), so the left margin only needs room for ticks.
 */
export function chartMargin(narrow, { left = 70, right = 20, top } = {}) {
  return narrow
    ? { top: top ?? 12, right: 8, left: 4, bottom: 8 }
    : { top: top ?? 16, right, left, bottom: 12 };
}

/**
 * Legend wrapper: the full chart width, centred, with a row kept free below
 * it for the PolicyEngine logo (drawn at the bottom right), so the logo
 * never pushes the legend off centre.
 */
export function legendWrapperStyle(narrow) {
  return {
    left: 0,
    width: "100%",
    boxSizing: "border-box",
    paddingTop: narrow ? 12 : 16,
    paddingBottom: 30,
    lineHeight: narrow ? "20px" : "22px",
  };
}

export function legendLabelStyle(narrow) {
  return {
    color: "#374151",
    fontSize: narrow ? "12px" : "13px",
    fontWeight: 400,
  };
}

export const TOOLTIP_CONTENT_STYLE = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: "6px",
  boxShadow: "0 4px 12px rgba(17, 24, 39, 0.08)",
  fontSize: "13px",
};

/** Short fiscal year label for a phone axis: 2026 -> "26–27". */
export function shortFiscalYearTick(year) {
  const y = Number(year);
  return `${String(y).slice(-2)}\u2013${String(y + 1).slice(-2)}`;
}

/** Fiscal year label: 2026 -> "2026-27". */
export function fiscalYearTick(year) {
  const y = Number(year);
  return `${y}-${(y + 1).toString().slice(-2)}`;
}

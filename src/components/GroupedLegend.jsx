import { useLayoutEffect, useRef, useState } from "react";
import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import { legendGrid, LEGEND_COLUMN_GAP } from "../utils/legendLayout";
import "./GroupedLegend.css";

/**
 * Split legend items into the two groups, "Raise revenue" then "Cost
 * revenue", keeping their order; empty groups are left out. Items that are
 * not policies (no `raises`) form one group with no heading.
 *
 * @param {Array<{label: string, color: string, raises?: boolean}>} items
 */
export function legendGroups(items) {
  if (items.length > 0 && items.every((item) => item.raises === undefined)) {
    return [[null, items]];
  }
  return [
    ["Raise revenue", items.filter((item) => item.raises)],
    ["Cost revenue", items.filter((item) => !item.raises)],
  ].filter(([, groupItems]) => groupItems.length > 0);
}

/** The dashboard's policy names as legend items, coloured as in the charts. */
export const policyItems = (names) =>
  names.map((name) => ({
    label: name,
    color: POLICY_COLORS[name],
    raises: REVENUE_RAISING_NAMES.has(name),
  }));

/** A legend key: a square, or a short line (dashed when `dash` is set). */
function Swatch({ item, measure = false }) {
  if (item.type === "line") {
    return (
      <svg
        className="grouped-legend-swatch-line"
        width="20"
        height="10"
        viewBox="0 0 20 10"
        aria-hidden="true"
      >
        {!measure && (
          <line
            x1="0"
            y1="5"
            x2="20"
            y2="5"
            stroke={item.color}
            strokeWidth="2.5"
            strokeDasharray={item.dash}
          />
        )}
      </svg>
    );
  }
  return (
    <span
      className="grouped-legend-swatch"
      style={measure ? undefined : { background: item.color }}
      aria-hidden="true"
    />
  );
}

/**
 * A chart legend: each group's heading spans the legend, and its items flow
 * into even columns shared by every group (two or three across a card, one
 * on a phone; see legendGrid). The net line sits centred under them and the
 * whole block is centred under the plot.
 *
 * Pass `names` (dashboard policy names) or `items`.
 */
function GroupedLegend({ names, items, netLabel }) {
  const all = items ?? policyItems(names ?? []);
  const groups = legendGroups(all);
  const ref = useRef(null);
  const measureRef = useRef(null);
  // Columns and their width, from the measured widths, on every resize;
  // one natural-width column until measured
  const [grid, setGrid] = useState(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const measure = measureRef.current;
    if (!node || !measure) return undefined;
    const decide = () => {
      const widths = [...measure.querySelectorAll("[data-measure]")].map(
        (item) => item.getBoundingClientRect().width,
      );
      const itemWidth = Math.ceil(Math.max(0, ...widths)) + 1;
      if (itemWidth <= 1 || node.clientWidth <= 0) return;
      const next = legendGrid({
        available: node.clientWidth,
        itemWidth,
        counts: groups.map(([, groupItems]) => groupItems.length),
      });
      setGrid((current) =>
        current &&
        current.columns === next.columns &&
        Math.abs(current.columnWidth - next.columnWidth) < 0.5
          ? current
          : next,
      );
    };
    decide();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(decide);
    observer.observe(node);
    return () => observer.disconnect();
  });

  const columns = grid?.columns ?? 1;
  const template = grid
    ? `repeat(${grid.columns}, ${Math.floor(grid.columnWidth)}px)`
    : "minmax(0, max-content)";

  return (
    <div ref={ref} className="grouped-legend" data-columns={columns}>
      {/* Off-screen copy, one line per item, to measure natural widths */}
      <div ref={measureRef} className="grouped-legend-measure" aria-hidden="true">
        {all.map((item) => (
          <span key={item.label} data-measure className="grouped-legend-measure-item">
            <Swatch item={item} measure />
            {item.label}
          </span>
        ))}
      </div>
      <div
        className="grouped-legend-groups"
        style={{ gridTemplateColumns: template, columnGap: LEGEND_COLUMN_GAP }}
      >
        {groups.map(([heading, groupItems]) => (
          <div key={heading ?? "items"} className="grouped-legend-group">
            {heading && <p className="grouped-legend-heading">{heading}</p>}
            <ul className="grouped-legend-items">
              {groupItems.map((item) => (
                <li key={item.label}>
                  <Swatch item={item} />
                  <span className="grouped-legend-label">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {netLabel && (
        <p className="grouped-legend-net">
          <span className="grouped-legend-line" aria-hidden="true" />
          {netLabel}
        </p>
      )}
    </div>
  );
}

export default GroupedLegend;

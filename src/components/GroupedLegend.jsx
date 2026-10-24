import { useLayoutEffect, useRef, useState } from "react";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import "./GroupedLegend.css";

// A group with more items than this may split into two sub-columns
const SPLIT_ABOVE = 5;
// Gaps, as in GroupedLegend.css
const COLUMN_GAP = 32;
const SUB_GAP = 24;

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
    ["Raise revenue", items.filter((item) => item.direction !== "neutral" && item.raises)],
    ["Cost revenue", items.filter((item) => item.direction !== "neutral" && !item.raises)],
    ["Other measures", items.filter((item) => item.direction === "neutral")],
  ].filter(([, groupItems]) => groupItems.length > 0);
}

/** The dashboard's policy names as legend items, coloured as in the charts. */
export const policyItems = (names, catalogue) =>
  names.map((name) => ({
    key: name,
    label: catalogue.bySeriesKey.get(name)?.label ?? name,
    color: catalogue.policyColors[name],
    raises: catalogue.revenueRaisingNames.has(name),
    direction: catalogue.bySeriesKey.get(name)?.direction,
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
 * A chart legend: the groups side by side as columns (each a tidy list,
 * one item a line), the net line centred under them, the whole block
 * centred under the plot. Narrow containers stack the groups.
 *
 * Pass `names` (dashboard policy names) or `items`.
 */
function GroupedLegend({ names, items, netLabel }) {
  const catalogue = useMeasureCatalogue();
  const all = items ?? policyItems(names ?? [], catalogue);
  const groups = legendGroups(all);
  const ref = useRef(null);
  const measureRef = useRef(null);
  // "split": the first group in two sub-columns beside the others;
  // "columns": one column per group, side by side; "stacked": groups
  // one under another. Chosen from the measured widths, on every resize.
  const [layout, setLayout] = useState("stacked");

  useLayoutEffect(() => {
    const node = ref.current;
    const measure = measureRef.current;
    if (!node || !measure) return undefined;
    const decide = () => {
      const available = node.clientWidth;
      const widths = [...measure.querySelectorAll("[data-group]")].map((group) =>
        Math.max(
          0,
          ...[...group.querySelectorAll("[data-measure]")].map(
            (item) => item.getBoundingClientRect().width,
          ),
        ),
      );
      const counts = groups.map(([, groupItems]) => groupItems.length);
      const columnsWidth =
        widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP * (widths.length - 1);
      const splitWidth =
        columnsWidth + widths.reduce(
          (sum, width, index) => sum + (counts[index] > SPLIT_ABOVE ? width + SUB_GAP : 0),
          0,
        );
      const next =
        counts.some((count) => count > SPLIT_ABOVE) && splitWidth <= available
          ? "split"
          : columnsWidth <= available
            ? "columns"
            : "stacked";
      setLayout((current) => (current === next ? current : next));
    };
    decide();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(decide);
    observer.observe(node);
    return () => observer.disconnect();
  });

  return (
    <div ref={ref} className={`grouped-legend is-${layout}`}>
      {/* Off-screen copy, one line per item, to measure natural widths */}
      <div ref={measureRef} className="grouped-legend-measure" aria-hidden="true">
        {groups.map(([heading, groupItems]) => (
          <div key={heading ?? "items"} data-group>
            {heading && (
              <span data-measure className="grouped-legend-heading">{heading}</span>
            )}
            {groupItems.map((item) => (
              <span key={item.key ?? item.label} data-measure className="grouped-legend-measure-item">
                <Swatch item={item} measure />
                {item.label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="grouped-legend-groups">
        {groups.map(([heading, groupItems]) => {
          const split = layout === "split" && groupItems.length > SPLIT_ABOVE;
          return (
            <div key={heading ?? "items"} className="grouped-legend-group">
              {heading && <p className="grouped-legend-heading">{heading}</p>}
              <ul className={`grouped-legend-items ${split ? "is-split" : ""}`}>
                {groupItems.map((item) => (
                  <li key={item.key ?? item.label}>
                    <Swatch item={item} />
                    <span className="grouped-legend-label">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
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

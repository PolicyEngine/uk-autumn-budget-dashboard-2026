import { useEffect, useRef, useState } from "react";
import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import "./GroupedLegend.css";

// Below this width the groups stack; above it they sit side by side
const STACK_BELOW = 520;
// A group with more items than this splits into two sub-columns
const SPLIT_ABOVE = 5;

/**
 * Split legend items into the two groups, "Raise revenue" then "Cost
 * revenue", keeping their order; empty groups are left out.
 *
 * @param {Array<{label: string, color: string, raises: boolean}>} items
 */
export function legendGroups(items) {
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

/**
 * A chart legend: the groups side by side as columns (each a tidy list,
 * one item a line), the net line centred under them, the whole block
 * centred under the plot. Narrow containers stack the groups.
 *
 * Pass `names` (dashboard policy names) or `items`.
 */
function GroupedLegend({ names, items, netLabel }) {
  const all = items ?? policyItems(names ?? []);
  const groups = legendGroups(all);
  const ref = useRef(null);
  const [stacked, setStacked] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setStacked(entry.contentRect.width < STACK_BELOW),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`grouped-legend ${stacked ? "is-stacked" : ""}`}>
      <div className="grouped-legend-groups">
        {groups.map(([heading, groupItems]) => {
          const split = !stacked && groupItems.length > SPLIT_ABOVE;
          return (
            <div key={heading} className="grouped-legend-group">
              <p className="grouped-legend-heading">{heading}</p>
              <ul className={`grouped-legend-items ${split ? "is-split" : ""}`}>
                {groupItems.map((item) => (
                  <li key={item.label}>
                    <span
                      className="grouped-legend-swatch"
                      style={{ background: item.color }}
                      aria-hidden="true"
                    />
                    {item.label}
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

import { useLayoutEffect, useRef, useState } from "react";
import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import { legendLayout, subColumns } from "../utils/legendLayout";
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
function Swatch({ item }) {
  if (item.type === "line") {
    return (
      <svg
        className="grouped-legend-swatch-line"
        width="20"
        height="10"
        viewBox="0 0 20 10"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="5"
          x2="20"
          y2="5"
          stroke={item.color}
          strokeWidth="2.5"
          strokeDasharray={item.dash}
        />
      </svg>
    );
  }
  return (
    <span
      className="grouped-legend-swatch"
      style={{ background: item.color }}
      aria-hidden="true"
    />
  );
}

// The legend's font, as in GroupedLegend.css
const LABEL_FONT = { fontSize: 12.5, fontWeight: "400" };
const HEADING_FONT = { fontSize: 11, fontWeight: "600" };
// The swatch and its gap
const ICON_WIDTH = 16;

/** Text widths from a canvas in the legend's font, or an estimate where
 * there is no canvas (tests). */
function textMeasurer(node) {
  const family = node ? getComputedStyle(node).fontFamily : "";
  let context = null;
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    context = null;
  }
  const make = ({ fontSize, fontWeight }) => (text) => {
    if (!context) return String(text).length * fontSize * 0.55;
    context.font = `${fontWeight} ${fontSize}px ${family || "system-ui, sans-serif"}`;
    // A pixel of slack, so the browser never wraps a label the layout
    // measured as fitting
    return context.measureText(String(text)).width + 1;
  };
  return { label: make(LABEL_FONT), heading: make(HEADING_FONT) };
}

/**
 * A chart legend: each group ("Raise revenue", "Cost revenue") under its
 * own heading, the groups side by side, a group of more than three items
 * in two sub-columns, labels wrapped where needed; the net line centred
 * under them, the whole block centred under the plot. The layout
 * (legendLayout, shared with the export) is chosen from the measured
 * width, on every resize: one column on a phone.
 *
 * Pass `names` (dashboard policy names) or `items`.
 */
function GroupedLegend({ names, items, netLabel }) {
  const all = items ?? policyItems(names ?? []);
  const groups = legendGroups(all);
  const ref = useRef(null);
  const [layout, setLayout] = useState(null);
  const signature = groups
    .map(([heading, groupItems]) => `${heading}:${groupItems.map((item) => item.label).join("|")}`)
    .join("/");

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = textMeasurer(node);
    const decide = () => {
      const next = legendLayout({
        groups: groups.map(([heading, groupItems]) => ({
          heading,
          labels: groupItems.map((item) => item.label),
        })),
        available: node.clientWidth,
        measure: measure.label,
        measureHeading: measure.heading,
        iconWidth: ICON_WIDTH,
      });
      const key = JSON.stringify(next);
      setLayout((current) => (current && current.key === key ? current : { ...next, key }));
    };
    decide();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(decide);
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const mode = layout?.mode ?? "stacked";
  return (
    <div ref={ref} className={`grouped-legend is-${mode}`}>
      <div className="grouped-legend-groups">
        {groups.map(([heading, groupItems], index) => {
          const laid = layout?.groups[index];
          const columns = laid ? subColumns(groupItems, laid.columns) : [groupItems];
          const width = laid && mode !== "stacked" ? `${laid.width}px` : undefined;
          return (
            <div key={heading ?? "items"} className="grouped-legend-group">
              {heading && <p className="grouped-legend-heading">{heading}</p>}
              <div className="grouped-legend-columns">
                {columns.map((column, columnIndex) => (
                  <ul
                    key={columnIndex}
                    className="grouped-legend-items"
                    style={width ? { width } : undefined}
                  >
                    {column.map((item) => (
                      <li key={item.label}>
                        <Swatch item={item} />
                        <span className="grouped-legend-label">{item.label}</span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
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

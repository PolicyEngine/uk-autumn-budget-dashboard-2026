import { useLayoutEffect, useRef, useState } from "react";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { FLOW_BELOW, flowWidth, legendLayout, subColumns } from "../utils/legendLayout";
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
      style={{ background: item.muted ? "transparent" : item.color }}
      aria-hidden="true"
    />
  );
}

/** An item's label, with its note behind an "i" when it has one. */
function ItemLabel({ item }) {
  return (
    <>
      <span className="grouped-legend-label">{item.label}</span>
      {item.info && (
        <span className="info-icon-wrapper grouped-legend-info">
          <button type="button" className="info-icon" aria-label={`About ${item.label}`}>
            i
          </button>
          <span className="info-tooltip" role="tooltip">
            {item.info}
          </span>
        </span>
      )}
    </>
  );
}

// The room an "i" takes after a label: its button and gap
const INFO_WIDTH = 22;

// The legend's font, as in GroupedLegend.css
const LABEL_FONT = { fontSize: 12.5, fontWeight: "400" };
const HEADING_FONT = { fontSize: 11, fontWeight: "600" };
// The swatch and its gap
const ICON_WIDTH = 16;
// A line key (20px) and its gap; the net line (14px) and its gap
const LINE_ICON_WIDTH = 26;
const NET_ICON_WIDTH = 20;

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
 * Pass `names` (dashboard policy names) or `items`. An item with `muted`
 * (a measure that is £0 in the year shown, legendMembership) is greyed out.
 */
function GroupedLegend({ names, items, netLabel }) {
  const catalogue = useMeasureCatalogue();
  const all = items ?? policyItems(names ?? [], catalogue);
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
    // A label with an "i" is measured with the room the "i" takes
    const infoFor = new Map(all.map((item) => [item.label, Boolean(item.info)]));
    const measureLabel = (text) => measure.label(text) + (infoFor.get(text) ? INFO_WIDTH : 0);
    const decide = () => {
      const next = legendLayout({
        groups: groups.map(([heading, groupItems]) => ({
          heading,
          labels: groupItems.map((item) => item.label),
        })),
        available: node.clientWidth,
        measure: measureLabel,
        measureHeading: measure.heading,
        iconWidth: ICON_WIDTH,
      });
      // A narrow card flows the items into rows (GroupedLegend.css): the
      // block takes the widest row's width, so it is centred under the
      // chart with its rows left-aligned
      const available = node.clientWidth;
      next.flow = null;
      if (available > 0 && available <= FLOW_BELOW) {
        const widths = groups.map(([heading, groupItems], index) => {
          const items = groupItems.map(
            (item) => (item.type === "line" ? LINE_ICON_WIDTH : ICON_WIDTH) + measure.label(item.label),
          );
          if (netLabel && index === groups.length - 1) {
            items.push(NET_ICON_WIDTH + measure.label(netLabel));
          }
          return Math.max(heading ? measure.heading(heading) : 0, flowWidth(items, available));
        });
        next.flow = Math.min(available, Math.ceil(Math.max(0, ...widths)) + 1);
      }
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

  // A short legend with no groups (before / after): one row, side by side
  if (groups.length === 1 && !groups[0][0] && all.length <= 3) {
    return (
      <div ref={ref} className="grouped-legend is-row">
        <ul className="grouped-legend-row">
          {all.map((item) => (
            <li key={item.key ?? item.label} className={`grouped-legend-item${item.muted ? " is-muted" : ""}`}>
              <Swatch item={item} />
              <ItemLabel item={item} />
            </li>
          ))}
        </ul>
        {netLabel && (
          <p className="grouped-legend-net">
            <span className="grouped-legend-line" aria-hidden="true" />
            {netLabel}
          </p>
        )}
      </div>
    );
  }

  const mode = layout?.mode ?? "stacked";
  return (
    <div ref={ref} className={`grouped-legend is-${mode}`}>
      <div
        className="grouped-legend-groups"
        style={layout?.flow ? { width: `${layout.flow}px` } : undefined}
      >
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
                      <li key={item.key ?? item.label} className={item.muted ? "is-muted" : undefined}>
                        <Swatch item={item} />
                        <ItemLabel item={item} />
                      </li>
                    ))}
                    {/* In a narrow card the items flow and the net line
                        joins the last row (CSS); elsewhere it sits below */}
                    {netLabel &&
                      index === groups.length - 1 &&
                      columnIndex === columns.length - 1 && (
                        <li className="grouped-legend-net-inline" aria-hidden="true">
                          <span className="grouped-legend-line" />
                          <span className="grouped-legend-label">{netLabel}</span>
                        </li>
                      )}
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

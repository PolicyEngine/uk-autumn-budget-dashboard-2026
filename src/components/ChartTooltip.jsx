import { useMeasureCatalogue } from "../utils/measureCatalogue";
import "./ChartTooltip.css";

/** A signed value with a true minus, for tooltips. */
export const signed = (text, value) => (value < 0 ? `−${text}` : text);

/**
 * One tooltip for every Recharts chart: dark text, a swatch per row, label
 * left and value right; policy rows grouped under Raise revenue / Cost
 * revenue as in the legend; the net row bold under a hairline.
 *
 * Use as <Tooltip content={<ChartTooltip format={…} … />} {...TOOLTIP_PROPS} />.
 *
 * @param {Object} props
 * @param {(value: number) => string} props.format - Absolute value text
 * @param {(label: any) => string} [props.labelFormat]
 * @param {string} [props.netKey] - dataKey of the net series
 * @param {string} [props.netLabel]
 * @param {boolean} [props.grouped] - Group policy rows (default true)
 * @param {{key: string, label: string, color: string}} [props.single] - Show
 *   one value from the hovered point instead of the series
 * @param {boolean} [props.showPlus] - Mark rises with "+" as well as falls
 *   with "−" (for changes)
 * @param {boolean} [props.showZero] - Keep rows whose value is zero (by
 *   default they are left out)
 */
function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat = (value) => value,
  netKey,
  netLabel = "Net impact",
  grouped = true,
  single,
  showPlus = false,
  showZero = false,
  // A line under the rows from the hovered point (e.g. the people a
  // poverty change is), or nothing
  note,
}) {
  const { bySeriesKey } = useMeasureCatalogue();
  if (!active || !payload?.length) return null;
  // One value from the hovered point (e.g. the change in net income)
  const singleRows = single
    ? [
        {
          key: single.key,
          name: single.label,
          value: Number(payload[0].payload?.[single.key]),
          color: single.color,
        },
      ]
    : null;
  const rows = singleRows ?? payload
    .filter((entry) => entry.dataKey !== netKey && entry.value !== null && entry.value !== undefined)
    .filter((entry) => showZero || Math.abs(Number(entry.value)) > 1e-9)
    .map((entry) => ({
      key: String(entry.dataKey),
      name: bySeriesKey.get(String(entry.dataKey))?.label ?? entry.name,
      value: Number(entry.value),
      text: entry.text,
      color: bySeriesKey.get(String(entry.dataKey))?.color ?? entry.color ?? entry.fill ?? entry.stroke,
      direction: bySeriesKey.get(String(entry.dataKey))?.direction,
    }))
    .sort((a, b) => (bySeriesKey.get(a.key)?.order ?? Infinity) - (bySeriesKey.get(b.key)?.order ?? Infinity));
  const net = netKey ? payload.find((entry) => entry.dataKey === netKey) : null;
  const sections =
    grouped && rows.some((row) => bySeriesKey.has(row.key))
      ? [
          ["Raise revenue", rows.filter((row) => row.direction === "revenue")],
          ["Cost revenue", rows.filter((row) => row.direction === "cost")],
          ["Other measures", rows.filter((row) => row.direction !== "revenue" && row.direction !== "cost")],
        ].filter(([, sectionRows]) => sectionRows.length > 0)
      : [[null, rows]];

  const noteText = note ? note(payload[0]?.payload) : null;
  const valueText = (value) =>
    showPlus && value > 0 ? `+${format(value)}` : signed(format(Math.abs(value)), value);

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{labelFormat(label)}</p>
      {sections.map(([heading, sectionRows]) => (
        <div key={heading ?? "rows"} className="chart-tooltip-section">
          {heading && <p className="chart-tooltip-heading">{heading}</p>}
          {sectionRows.map((row) => (
            <div key={row.key} className="chart-tooltip-row">
              <span className="chart-tooltip-swatch" style={{ background: row.color }} />
              <span className="chart-tooltip-name">{row.name}</span>
              <span className="chart-tooltip-value">{row.text ?? valueText(row.value)}</span>
            </div>
          ))}
        </div>
      ))}
      {net && net.value !== null && net.value !== undefined && (
        <div className="chart-tooltip-row chart-tooltip-net">
          <span className="chart-tooltip-swatch chart-tooltip-swatch-line" />
          <span className="chart-tooltip-name">{netLabel}</span>
          <span className="chart-tooltip-value">{valueText(Number(net.value))}</span>
        </div>
      )}
      {noteText && <p className="chart-tooltip-note">{noteText}</p>}
    </div>
  );
}

/**
 * Placement shared by every chart: beside the hovered column (right by
 * default, flipped left near the right edge, as Recharts does), 12px away,
 * and kept inside the plot so it never covers the title or description.
 */
// On a touch screen (no hover) a chart's tooltip opens on a tap
const TOUCH =
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;

/**
 * One stacked segment's tooltip, for a chart whose Tooltip has
 * shared={false}: the bar's label, the hovered measure and its value, then
 * the bar's net under a hairline. Beside the cursor, so it never covers the
 * whole bar (Vahid, 26 October).
 *
 * @param {Object} props
 * @param {(row: Object) => string} props.labelOf - The bar's label from its row
 * @param {(value: number) => string} props.format - Absolute value text
 * @param {string} [props.netKey] - The row's net, shown under the measure
 * @param {string} [props.netLabel]
 */
export function SegmentTooltip({ active, payload, labelOf, format, netKey, netLabel = "Net change" }) {
  if (!active || !payload?.length) return null;
  const entry = payload.find((item) => item.dataKey !== netKey) ?? payload[0];
  const row = entry.payload ?? {};
  const value = Number(entry.value);
  const text = (v) => (v < 0 ? `−${format(Math.abs(v))}` : `+${format(Math.abs(v))}`);
  const net = netKey ? Number(row[netKey]) : NaN;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{labelOf(row)}</p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: entry.color }} />
        <span className="chart-tooltip-name">{entry.name}</span>
        <span className="chart-tooltip-value">{text(value)}</span>
      </div>
      {Number.isFinite(net) && (
        <div className="chart-tooltip-row chart-tooltip-net">
          <span className="chart-tooltip-swatch chart-tooltip-swatch-line" />
          <span className="chart-tooltip-name">{netLabel}</span>
          <span className="chart-tooltip-value">{text(net)}</span>
        </div>
      )}
    </div>
  );
}

export const TOOLTIP_PROPS = {
  trigger: TOUCH ? "click" : "hover",
  offset: 12,
  allowEscapeViewBox: { x: false, y: false },
  isAnimationActive: false,
  wrapperStyle: { zIndex: 20, pointerEvents: "none" },
};

export default ChartTooltip;

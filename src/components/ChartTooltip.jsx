import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
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
      name: entry.name,
      value: Number(entry.value),
      // A value already written out (FloatingTooltip's TooltipRows)
      text: entry.text,
      color: POLICY_COLORS[entry.name] ?? entry.color ?? entry.fill ?? entry.stroke,
    }));
  const net = netKey ? payload.find((entry) => entry.dataKey === netKey) : null;
  const sections =
    grouped && rows.some((row) => POLICY_COLORS[row.name])
      ? [
          ["Raise revenue", rows.filter((row) => REVENUE_RAISING_NAMES.has(row.name))],
          ["Cost revenue", rows.filter((row) => !REVENUE_RAISING_NAMES.has(row.name))],
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

export const TOOLTIP_PROPS = {
  trigger: TOUCH ? "click" : "hover",
  offset: 12,
  allowEscapeViewBox: { x: false, y: false },
  isAnimationActive: false,
  wrapperStyle: { zIndex: 20, pointerEvents: "none" },
};

export default ChartTooltip;

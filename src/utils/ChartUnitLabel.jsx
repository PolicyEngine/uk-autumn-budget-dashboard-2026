import { measureTextWidth } from "./textMeasure";
import { Y_TITLE_GUTTER, CHART_COLOURS } from "./chartTheme";

const FONT_SIZE = 12;
const MIN_FONT_SIZE = 10;

// A title above the plot: its baseline sits this far above the plot's top,
// so it clears the top tick label (centred on the plot's top edge, about
// 7px above it) by at least 14px, descenders included
const ABOVE_PLOT = 25;

/**
 * The top margin a chart with a title above its plot keeps: the title's
 * height above its baseline, plus ABOVE_PLOT, plus a little air, so neither
 * the title nor the top tick label is clipped.
 */
export const UNIT_LABEL_TOP_MARGIN = ABOVE_PLOT + FONT_SIZE + 6;

/**
 * The font size at which a title fits along a plot `length` pixels tall:
 * 12px, or smaller (down to 10px) for a title longer than the plot.
 */
export function yTitleFontSize(text, length) {
  if (typeof document === "undefined" || !length) return FONT_SIZE;
  let width = FONT_SIZE;
  try {
    width = measureTextWidth(text, { fontSize: FONT_SIZE, fontWeight: "500" });
  } catch {
    return FONT_SIZE;
  }
  if (!width || width <= length - 4) return FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.floor((FONT_SIZE * (length - 4)) / width));
}

/**
 * The chart's y-axis title, rotated −90° and centred along the y-axis, in
 * the gutter left of the tick labels (axisWidth reserves it). Drawn in the
 * chart's SVG, so the SVG and PNG downloads carry it.
 * Use with Recharts' <Customized component={<ChartUnitLabel text="…" />} />.
 */
function ChartUnitLabel({ text, yAxisMap, horizontal = false }) {
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!yAxis || !text) return null;
  // A long unit ("£ a year, 2027-28 prices") reads better as a short note
  // above the axis than squeezed along it; the chart keeps room for it in
  // its top margin.
  if (horizontal) {
    return (
      <text
        className="chart-unit-label"
        x={yAxis.x}
        y={yAxis.y - ABOVE_PLOT}
        fontSize={FONT_SIZE}
        fontWeight={500}
        fill={CHART_COLOURS.axisTitle}
        textAnchor="start"
      >
        {text}
      </text>
    );
  }
  const fontSize = yTitleFontSize(text, yAxis.height);
  // Rotated −90°, the glyphs rise to the left of the baseline: a baseline
  // at this x keeps the text inside the gutter.
  const x = yAxis.x + Y_TITLE_GUTTER - 10;
  const y = yAxis.y + yAxis.height / 2;
  return (
    <text
      className="chart-unit-label"
      x={x}
      y={y}
      transform={`rotate(-90, ${x}, ${y})`}
      fontSize={fontSize}
      fontWeight={500}
      fill={CHART_COLOURS.axisTitle}
      textAnchor="middle"
    >
      {text}
    </text>
  );
}

export default ChartUnitLabel;

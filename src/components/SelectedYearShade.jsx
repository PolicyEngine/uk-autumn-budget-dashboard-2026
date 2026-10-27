import { CHART_COLOURS } from "../utils/chartTheme";
import { chartTransition } from "../utils/chartMotion";

/**
 * The header-selected year's light shading behind a chart's year
 * category: the only year background on the page, the same on every chart.
 * One rect, moved by a transform, so a year change slides it (the motion
 * tokens); nothing when the year is not on this chart's axis.
 *
 * Use with Recharts' <Customized component={<SelectedYearShade value={…} />} />,
 * `value` being the x value of the selected year's category.
 */
export default function SelectedYearShade({ xAxisMap, yAxisMap, value }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (value == null || !xAxis?.scale || !yAxis) return null;
  const start = xAxis.scale(value);
  const width = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 0;
  if (start === undefined || Number.isNaN(start) || !width) return null;
  return (
    <rect
      className="selected-year-shade"
      x={0}
      y={yAxis.y}
      width={width}
      height={yAxis.height}
      fill={CHART_COLOURS.highlightBand}
      style={{ transform: `translateX(${start}px)`, transition: chartTransition("transform", "width") }}
    />
  );
}

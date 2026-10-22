/**
 * The chart's unit, as a small label above the plot at its left edge (in
 * place of a rotated y-axis title, so the plot can use the card's width).
 * Drawn in the chart's SVG, so the SVG and PNG downloads carry it.
 * Use with Recharts' <Customized component={<ChartUnitLabel text="…" />} />.
 */
function ChartUnitLabel({ text, yAxisMap }) {
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!yAxis || !text) return null;
  return (
    <text
      className="chart-unit-label"
      x={yAxis.x}
      y={12}
      fontSize={12}
      fontWeight={500}
      fill="#4B5563"
      textAnchor="start"
    >
      {text}
    </text>
  );
}

export default ChartUnitLabel;

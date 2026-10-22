import { useRef } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  LabelList,
  Customized,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { buildChartSvg, exportChartAsSvg } from "../utils/exportChartAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { revenueCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { POLICY_COLORS, ALL_POLICY_NAMES } from "../utils/policyConfig";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  legendLabelStyle,
  TOOLTIP_CONTENT_STYLE,
  fiscalYearTick,
  shortFiscalYearTick,
} from "../utils/chartTheme";
import "./BudgetaryImpactChart.css";
import "./ChartExport.css";
import {
  FIRST_DISPLAY_YEAR,
  LAST_DISPLAY_YEAR,
  NOT_YET_PUBLISHED,
} from "../utils/displayYears";

// Net impact labels, one per year, as on the 2025 dashboard: the signed
// total in a small white tag. A tag sits just above the year's stack of
// gains when the net is positive, and just below its stack of costs when
// negative, so it never covers a bar or the net line. They are part of the
// chart's SVG, so the SVG and PNG downloads carry them too.
const formatNetLabel = (value) =>
  value < 0 ? `-£${Math.abs(value).toFixed(1)}bn` : `+£${value.toFixed(1)}bn`;

function NetImpactLabels({ xAxisMap, yAxisMap, data, narrow, show }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const fontSize = narrow ? 11 : 12;
  const gap = 6;
  const tagHeight = fontSize + 8;
  const band = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 0;
  return (
    <g className="net-impact-labels">
      {data.map((point) => {
        const gains = ALL_POLICY_NAMES.reduce(
          (sum, name) => sum + Math.max(0, point[name] || 0),
          0,
        );
        const costs = ALL_POLICY_NAMES.reduce(
          (sum, name) => sum + Math.min(0, point[name] || 0),
          0,
        );
        const net = point.netImpact;
        const unpublished = point.unpublished || net === null || net === undefined;
        // Net tags show with two or more measures; a not-yet-published tag
        // always shows, so the empty year is never read as zero.
        if (!show && !unpublished) return null;
        const text = unpublished ? NOT_YET_PUBLISHED : formatNetLabel(net);
        // On a phone the not-yet-published tag takes two lines to fit its band
        const lines =
          unpublished && narrow ? ["Not yet", "published"] : [text];
        const longest = Math.max(...lines.map((line) => line.length));
        const width = Math.ceil(longest * fontSize * 0.6) + 10;
        const height = tagHeight + (lines.length - 1) * (fontSize + 2);
        const x = xAxis.scale(point.year) + band / 2;
        // A year not yet published has no bars: its tag sits on the zero line
        const top = unpublished
          ? yAxis.scale(0) - height / 2
          : net >= 0
            ? yAxis.scale(gains) - gap - tagHeight
            : yAxis.scale(costs) + gap;
        return (
          <g key={point.year}>
            <rect
              x={x - width / 2}
              y={top}
              width={width}
              height={height}
              rx={4}
              ry={4}
              fill={unpublished ? "#F9FAFB" : "#ffffff"}
              stroke="#D1D5DB"
              strokeWidth={1}
            />
            <text
              x={x}
              y={top + height / 2 - ((lines.length - 1) * (fontSize + 2)) / 2}
              fill={unpublished ? "#6B7280" : "#111827"}
              fontSize={fontSize}
              fontWeight={unpublished ? 500 : 600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {lines.map((line, index) => (
                <tspan key={line} x={x} dy={index === 0 ? 0 : fontSize + 2}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// Chart metadata for export
const CHART_TITLE = "Revenue impact";
const CHART_DESCRIPTION =
  `This chart shows the annual budgetary impact from ${fiscalYearTick(FIRST_DISPLAY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}, measured in billions of pounds. Positive values indicate revenue gains for the Government, whilst negative values indicate costs to the Treasury.`;

function BudgetaryImpactChart({ data, selectedYear }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  if (!data || data.length === 0) return null;

  const formatCurrencyTick = (value) =>
    value < 0 ? `-£${Math.abs(value)}bn` : `£${value}bn`;
  const formatCurrencyTooltip = (value) =>
    value < 0 ? `-£${Math.abs(value).toFixed(1)}bn` : `£${value.toFixed(1)}bn`;

  // Check which policies have non-zero values for legend/tooltip
  const hasNonZeroValues = (policyName) => {
    return data.some((d) => Math.abs(d[policyName] || 0) > 0.001);
  };

  const activePolicies = ALL_POLICY_NAMES.filter(hasNonZeroValues);

  // Y-axis domain: at least +/-10bn, widened to the next £5bn so the
  // tallest stacked bar sits under the top tick rather than above it.
  const stackExtent = (sign) =>
    Math.max(
      0,
      ...data.map((d) =>
        ALL_POLICY_NAMES.reduce((sum, name) => {
          const v = d[name] || 0;
          return sign * v > 0 ? sum + Math.abs(v) : sum;
        }, 0),
      ),
    );
  // £1.5bn of headroom leaves room for the net impact tags.
  const yAxisDomain = [
    -Math.max(10, Math.ceil((stackExtent(-1) + 1.5) / 5) * 5),
    Math.max(10, Math.ceil((stackExtent(1) + 1.5) / 5) * 5),
  ];

  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: name,
      type: "rect",
    })),
    ...(activePolicies.length > 1
      ? [{ color: "#000000", label: "Net impact", type: "line" }]
      : []),
  ];

  const exportName = "revenue-impact";
  const exportOptions = {
    title: CHART_TITLE,
    description: CHART_DESCRIPTION,
    legendItems,
    logo: CHART_LOGO,
  };
  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, exportName, exportOptions);
  };
  // One menu: the chart's data as CSV, and the SVG export as SVG or PNG.
  const downloads = {
    csv: () =>
      downloadFile(
        revenueCsv(data, activePolicies),
        `${exportName}.csv`,
        "text/csv;charset=utf-8",
      ),
    png: async () =>
      downloadSvgAsPng(await buildChartSvg(chartRef, exportOptions), exportName),
    svg: handleExportSvg,
  };

  return (
    <div className="budgetary-impact-chart">
      <div className="chart-header">
        <div>
          <h3>Revenue impact</h3>
          <p className="chart-description">
            This chart shows the annual budgetary impact from{" "}
            {fiscalYearTick(FIRST_DISPLAY_YEAR)} to{" "}
            {fiscalYearTick(LAST_DISPLAY_YEAR)},
            measured in billions of pounds. Positive values indicate revenue
            gains for the Government, whilst negative values indicate costs to
            the Treasury.
          </p>
        </div>
        <ChartDownloadMenu formats={downloads} chartTitle={CHART_TITLE} />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 540 : 400}>
          <ComposedChart
            data={data}
            margin={chartMargin(narrow, { left: 60, top: 32 })}
            stackOffset="sign"
          >
            <CartesianGrid {...GRID_PROPS} />
            {/* The year chosen in the title band, shaded behind its bars */}
            {data.some((point) => point.year === selectedYear) && (
              <ReferenceArea
                x1={selectedYear}
                x2={selectedYear}
                fill="#319795"
                fillOpacity={0.08}
                stroke="none"
                ifOverflow="extendDomain"
              />
            )}
            <XAxis
              dataKey="year"
              tick={TICK_STYLE}
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
              tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
            />
            <YAxis
              domain={yAxisDomain}
              width={narrow ? 48 : 60}
              axisLine={false}
              tickLine={false}
              label={
                narrow
                  ? undefined
                  : {
                      value: "Impact (£bn)",
                      angle: -90,
                      position: "insideLeft",
                      dx: -20,
                      style: AXIS_TITLE_STYLE,
                    }
              }
              tickFormatter={formatCurrencyTick}
              tick={TICK_STYLE}
              interval={0}
              ticks={(() => {
                const [min, max] = yAxisDomain;
                const interval = max <= 20 ? 5 : 10;
                const ticks = [];
                for (let i = min; i <= max + 0.001; i += interval) {
                  ticks.push(Math.round(i));
                }
                // Ensure 0 is always included
                if (!ticks.includes(0)) ticks.push(0);
                return ticks.sort((a, b) => a - b);
              })()}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrencyTooltip(value),
                name === "netImpact" ? "Net impact" : name,
              ]}
              labelFormatter={fiscalYearTick}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              wrapperStyle={{
                top: "-120px",
                left: "50%",
                transform: "translateX(-50%)",
              }}
              cursor={{ fill: "rgba(49, 151, 149, 0.1)" }}
            />
            <Legend
              wrapperStyle={legendWrapperStyle(narrow)}
              align="center"
              iconType="rect"
              iconSize={10}
              formatter={(value) => (
                <span style={legendLabelStyle(narrow)}>
                  {value === "netImpact" ? "Net impact" : value}
                </span>
              )}
              payload={[
                ...activePolicies.map((name) => ({
                  value: name,
                  type: "rect",
                  color: POLICY_COLORS[name],
                })),
                ...(activePolicies.length > 1
                  ? [
                      {
                        value: "Net impact",
                        type: "line",
                        color: "#000000",
                      },
                    ]
                  : []),
              ]}
            />
            {ALL_POLICY_NAMES.map((policyName) => (
              <Bar
                key={policyName}
                dataKey={policyName}
                fill={POLICY_COLORS[policyName]}
                name={policyName}
                stackId="stack"
                animationDuration={500}
                animationBegin={0}
                hide={!hasNonZeroValues(policyName)}
              />
            ))}
            <Line
              type="monotone"
              dataKey="netImpact"
              stroke="#000000"
              strokeWidth={2}
              dot={{ fill: "#000000", stroke: "#ffffff", strokeWidth: 1.5, r: 4 }}
              name="netImpact"
              animationDuration={500}
              hide={activePolicies.length <= 1}
            />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            <Customized
              component={
                <NetImpactLabels
                  data={data}
                  narrow={narrow}
                  show={activePolicies.length > 1}
                />
              }
            />
            <Customized component={PolicyEngineLogo} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default BudgetaryImpactChart;

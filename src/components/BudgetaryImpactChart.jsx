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
  ReferenceLine,
  LabelList,
  Customized,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { revenueCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import { POLICY_COLORS, ALL_POLICY_NAMES, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  legendLabelStyle,
  fiscalYearTick,
  shortFiscalYearTick,
  axisWidth,
  CHART_COLOURS,
} from "../utils/chartTheme";
import {
  NOT_YET_PUBLISHED,
} from "../utils/displayYears";
import { CHART_MOTION_MS, chartMotion, prefersReducedMotion } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";

// Net impact labels, one per year, as on the 2025 dashboard: the signed
// total in a small white tag. A tag sits just above the year's stack of
// gains when the net is positive, and just below its stack of costs when
// negative, so it never covers a bar or the net line. They are part of the
// chart's SVG, so the SVG and PNG downloads carry them too.
const formatNetLabel = (value) =>
  value < 0 ? `-£${Math.abs(value).toFixed(1)}bn` : `+£${value.toFixed(1)}bn`;

/**
 * The selected year's shading behind its bars. One rect, moved by a
 * transform, so a year change (or Play) slides it to the new year.
 */
function YearHighlight({ xAxisMap, yAxisMap, selectedYear }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis) return null;
  const start = xAxis.scale(selectedYear);
  if (start === undefined || Number.isNaN(start)) return null;
  const width = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 0;
  return (
    <rect
      className="revenue-year-highlight"
      x={0}
      y={yAxis.y}
      width={width}
      height={yAxis.height}
      fill={CHART_COLOURS.gain}
      fillOpacity={0.08}
      style={{
        transform: `translateX(${start}px)`,
        transition: prefersReducedMotion()
          ? undefined
          : `transform ${CHART_MOTION_MS}ms ease-in-out`,
      }}
    />
  );
}

function NetImpactLabels({ xAxisMap, yAxisMap, data, narrow, show, selectedYear }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  // On a narrow plot six tags collide: label only the year shown (the
  // tooltip gives every year's net)
  const crowded = xAxis.width < 460;
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
        if (crowded && !unpublished && point.year !== selectedYear) return null;
        const text = unpublished ? NOT_YET_PUBLISHED : formatNetLabel(net);
        // On a phone the not-yet-published tag takes two lines, in smaller
        // type, so it fits its year's band beside the last bar
        const twoLine = unpublished && narrow;
        const lines = twoLine ? ["Not yet", "published"] : [text];
        const size = twoLine ? 10 : fontSize;
        const longest = Math.max(...lines.map((line) => line.length));
        const width = Math.ceil(longest * size * 0.6) + (twoLine ? 6 : 10);
        const height = size + 8 + (lines.length - 1) * (size + 2);
        // Kept inside the plot, so a wide tag at either end is not clipped
        const x = Math.min(
          Math.max(xAxis.scale(point.year) + band / 2, xAxis.x + width / 2),
          xAxis.x + xAxis.width - width / 2,
        );
        // A year not yet published has no bars: its tag sits just above the
        // zero line. A negative net's tag goes below the year's costs, unless
        // that would reach the x-axis ticks: then above its gains instead
        const plotTop = yAxis.y;
        const plotBottom = yAxis.y + yAxis.height;
        const above = yAxis.scale(Math.max(gains, 0)) - gap - height;
        let top = unpublished
          ? yAxis.scale(0) - height - gap
          : net >= 0
            ? yAxis.scale(gains) - gap - tagHeight
            : yAxis.scale(costs) + gap;
        if (!unpublished && net < 0 && top + height > plotBottom - 2) top = above;
        top = Math.max(top, plotTop);
        return (
          <g key={point.year}>
            <rect
              x={x - width / 2}
              y={top}
              width={width}
              height={height}
              rx={4}
              ry={4}
              fill={unpublished ? CHART_COLOURS.mutedFill : CHART_COLOURS.surface}
              stroke={CHART_COLOURS.axis}
              strokeWidth={1}
            />
            <text
              x={x}
              y={top + height / 2 - ((lines.length - 1) * (size + 2)) / 2}
              fill={unpublished ? CHART_COLOURS.tick : CHART_COLOURS.text}
              fontSize={size}
              fontWeight={unpublished ? 500 : 600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {lines.map((line, index) => (
                <tspan key={line} x={x} dy={index === 0 ? 0 : size + 2}>
                  {index === 0 ? line : ` ${line}`}
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
  `Change in government revenue each year, £bn. Above zero raises revenue; below zero costs the Treasury.`;

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
  // Fitted to the data with about 5% padding (the net tags use the top
  // margin),
  // on round steps; zero is always in range.
  const gainsTop = stackExtent(1) * 1.05;
  const costsBottom = stackExtent(-1) * 1.05;
  const span = Math.max(gainsTop + costsBottom, 1);
  const tickStep = span <= 4 ? 1 : span <= 10 ? 2 : span <= 40 ? 5 : 10;
  const yAxisDomain = [
    -Math.ceil(costsBottom / tickStep) * tickStep,
    Math.max(tickStep, Math.ceil(gainsTop / tickStep) * tickStep),
  ];

  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: name,
      type: "rect",
      group: REVENUE_RAISING_NAMES.has(name) ? "raise" : "cost",
    })),
    ...(activePolicies.length > 1
      ? [{ color: CHART_COLOURS.net, label: "Net impact", type: "line" }]
      : []),
  ];

  const exportName = "revenue-impact";
  const exportOptions = {
    title: CHART_TITLE,
    description: CHART_DESCRIPTION,
    legendItems,
    logo: CHART_LOGO,
  };
  // One menu: the chart's data as CSV, and the chart as PNG or SVG.
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: () => revenueCsv(data, activePolicies),
  };

  return (
    <div className="budgetary-impact-chart">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="landmark" />
            <span className="title-text">Revenue impact</span>
          </h3>
          <p className="chart-description">{CHART_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={CHART_TITLE} />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 540 : 400}>
          <ComposedChart
            data={data}
            margin={chartMargin(narrow, { top: 24 })}
            stackOffset="sign"
          >
            <CartesianGrid {...GRID_PROPS} />
            {/* The year chosen in the title band, shaded behind its bars */}
            {data.some((point) => point.year === selectedYear) && (
              <Customized component={<YearHighlight selectedYear={selectedYear} />} />
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
              width={axisWidth(yAxisDomain, formatCurrencyTick)}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatCurrencyTick}
              tick={TICK_STYLE}
              interval={0}
              ticks={(() => {
                const [min, max] = yAxisDomain;
                const interval = tickStep;
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

              {...TOOLTIP_PROPS}

              cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}

              content={

                <ChartTooltip

                  format={(value) => `£${value.toFixed(1)}bn`}

                  labelFormat={fiscalYearTick}

                  netKey="netImpact"

                />

              }

            />
            <Legend
              wrapperStyle={legendWrapperStyle(narrow)}
              content={
                <GroupedLegend
                  names={activePolicies}
                  netLabel={activePolicies.length > 1 ? "Net impact" : undefined}
                />
              }
            />
            {ALL_POLICY_NAMES.map((policyName) => (
              <Bar
                key={policyName}
                dataKey={policyName}
                fill={POLICY_COLORS[policyName]}
                name={policyName}
                stackId="stack"
                {...chartMotion()}
                // Always mounted (a zero series has no height), so a series that
                // starts in a later year grows in place instead of remounting
              />
            ))}
            <Line
              // A smooth net line that never overshoots its points (monotone)
              type="monotone"
              strokeLinejoin="round"
              strokeLinecap="round"
              dataKey="netImpact"
              stroke={CHART_COLOURS.net}
              strokeWidth={1.75}
              dot={{ fill: CHART_COLOURS.net, stroke: CHART_COLOURS.surface, strokeWidth: 1.5, r: 4 }}
              name="netImpact"
              {...chartMotion()}
              hide={activePolicies.length <= 1}
            />
            <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
            <Customized
              component={
                <NetImpactLabels
                  data={data}
                  narrow={narrow}
                  selectedYear={selectedYear}
                  show
                />
              }
            />
            <Customized component={<ChartUnitLabel text="Impact (£bn)" />} />
            <Customized component={PolicyEngineLogo} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default BudgetaryImpactChart;

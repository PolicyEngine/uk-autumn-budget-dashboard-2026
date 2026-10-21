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

// Chart metadata for export
const CHART_TITLE = "Revenue impact";
const CHART_DESCRIPTION =
  "This chart shows the annual budgetary impact from 2026-27 to 2030-31, measured in billions of pounds. Positive values indicate revenue gains for the Government, whilst negative values indicate costs to the Treasury.";

function BudgetaryImpactChart({ data }) {
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
  const yAxisDomain = [
    -Math.max(10, Math.ceil(stackExtent(-1) / 5) * 5),
    Math.max(10, Math.ceil(stackExtent(1) / 5) * 5),
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
          <h2>Revenue impact</h2>
          <p className="chart-description">
            This chart shows the annual budgetary impact from 2026-27 to 2030-31,
            measured in billions of pounds. Positive values indicate revenue
            gains for the Government, whilst negative values indicate costs to
            the Treasury.
          </p>
        </div>
        <ChartDownloadMenu formats={downloads} />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 540 : 400}>
          <ComposedChart
            data={data}
            margin={chartMargin(narrow, { left: 60 })}
            stackOffset="sign"
          >
            <CartesianGrid {...GRID_PROPS} />
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
              align="left"
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
            <Customized component={PolicyEngineLogo} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default BudgetaryImpactChart;

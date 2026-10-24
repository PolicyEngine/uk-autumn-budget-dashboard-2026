import { useState, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Customized,
  Legend,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { householdChangeCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import HouseholdPicker from "./HouseholdPicker";
import useIncomeCurve from "../hooks/useIncomeCurve";
import {
  EXAMPLE_HOUSEHOLDS,
  exampleHousehold,
  formatPounds,
  formatPoundsShort,
  roundTicks,
} from "../utils/exampleHouseholds";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  legendWrapperStyle,
  legendLabelStyle,
  CHART_COLOURS,
} from "../utils/chartTheme";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { chartMotion } from "../utils/chartMotion";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

// Legend items for export
const LEGEND_ITEMS = [
  { color: CHART_COLOURS.gain, label: "Higher net income", type: "rect" },
  { color: CHART_COLOURS.loss, label: "Lower net income", type: "rect" },
];

/**
 * The change in an example household's net income from the selected
 * policies, across its income grid. The card's own chooser picks the
 * household; App passes one shared choice so both cards show the same one.
 */
function EmploymentIncomeDiffChart({
  selectedPolicies,
  selectedYear = DEFAULT_DISPLAY_YEAR,
  defaultHousehold = EXAMPLE_HOUSEHOLDS[1].id,
  household: controlledHousehold,
  onHouseholdChange,
}) {
  const [ownHousehold, setOwnHousehold] = useState(defaultHousehold);
  // A parent can control the choice so the two household cards stay in step
  const householdId = controlledHousehold ?? ownHousehold;
  const setHouseholdId = onHouseholdChange ?? setOwnHousehold;
  const household = exampleHousehold(householdId);
  const { loading, data: curve } = useIncomeCurve({
    household: household.id,
    year: selectedYear,
    policies: selectedPolicies,
  });
  const data = curve.map((point) => ({
    income: point.income,
    difference: point.difference,
    positive: point.difference >= 0 ? point.difference : null,
    negative: point.difference <= 0 ? point.difference : null,
  }));
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const chartTitle = `Net income change, ${formatYearRange(selectedYear)}`;

  // The income curve file covers this year only if it has rows for it
  const published = data.length > 0;
  const exportName = `net-income-change-${household.id}-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: `${household.label}: ${household.definition}`,
    legendItems: LEGEND_ITEMS,
    logo: CHART_LOGO,
  };
  // One menu: the chart's data as CSV, and the chart as PNG or SVG.
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: () => householdChangeCsv(data, { year: selectedYear, household }),
    published,
  };

  const xTicks = roundTicks(household.x_max);
  const picker = <HouseholdPicker value={household.id} onChange={setHouseholdId} />;

  if (loading) {
    return (
      <div className="employment-income-diff-chart">
        <div className="chart-header">
          <div>
            <h3>
              <NoBreakYear text={chartTitle} />
            </h3>
          </div>
        </div>
        {picker}
        <div style={{ textAlign: "center", padding: "40px", color: CHART_COLOURS.tick }}>
          Loading example households...
        </div>
      </div>
    );
  }

  // Calculate symmetric y-axis domain
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.difference)));
  const yMax = Math.ceil(maxAbs / 1000) * 1000 || 1000;
  // Symmetric ticks, set here so the axis is as wide as the longest label
  // ("-£500" is wider than "-£1k")
  const yTicks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];

  // Check if there are any non-null positive or negative values
  const hasPositive = data.some((d) => d.positive !== null && d.positive > 0);
  const hasNegative = data.some((d) => d.negative !== null && d.negative < 0);

  return (
    <div className="employment-income-diff-chart">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>
      {picker}

      <div ref={chartRef} className="chart-plot">
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 380 : 430}>
            <AreaChart
              data={data}
              margin={
                narrow
                  ? { top: 10, right: 16, left: 0, bottom: 0 }
                  : { top: 10, right: 16, left: 0, bottom: 0 }
              }
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="income"
                type="number"
                axisLine={AXIS_LINE}
                tickLine={false}
                label={{
                  value: household.x_label,
                  position: "insideBottom",
                  offset: 4,
                  style: AXIS_TITLE_STYLE,
                }}
                tickFormatter={formatPoundsShort}
                tick={TICK_STYLE}
                height={48}
                ticks={xTicks}
                domain={[0, xTicks[xTicks.length - 1]]}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickFormatter={formatPoundsShort}
                tick={TICK_STYLE}
                width={axisWidth(yTicks, formatPoundsShort)}
                ticks={yTicks}
                domain={[-yMax, yMax]}
              />

              <Tooltip

                {...TOOLTIP_PROPS}

                content={

                  <ChartTooltip

                    format={formatPounds}

                    labelFormat={(label) => `${household.x_label} ${formatPounds(label)}, ${formatYearRange(selectedYear)}`}

                    single={{ key: "difference", label: "Change in net income", color: CHART_COLOURS.gain }}

                  />

                }

              />
              {/* The same legend row as the chart beside it, so the pair
                  lines up */}
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                iconSize={18}
                verticalAlign="bottom"
                align="center"
                payload={LEGEND_ITEMS.map((item) => ({
                  value: item.label,
                  type: "rect",
                  color: item.color,
                }))}
                formatter={(value) => (
                  <span style={legendLabelStyle(narrow)}>{value}</span>
                )}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
              {hasPositive && (
                <Area
                  type="monotone"
                  dataKey="positive"
                  stroke={CHART_COLOURS.gain}
                  strokeWidth={2}
                  fill={CHART_COLOURS.gain}
                  fillOpacity={0.6}
                  baseValue={0}
                  connectNulls={false}
                  {...chartMotion()}
                />
              )}
              {hasNegative && (
                <Area
                  type="monotone"
                  dataKey="negative"
                  stroke={CHART_COLOURS.loss}
                  strokeWidth={2}
                  fill={CHART_COLOURS.loss}
                  fillOpacity={0.6}
                  baseValue={0}
                  connectNulls={false}
                  {...chartMotion()}
                />
              )}
              <Customized component={<ChartUnitLabel text="Change in net income" />} />
            <Customized component={PolicyEngineLogo} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={narrow ? 380 : 430}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default EmploymentIncomeDiffChart;

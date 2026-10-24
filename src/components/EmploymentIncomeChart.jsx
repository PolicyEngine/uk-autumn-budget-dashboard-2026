import { useState, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Customized,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { householdIncomeCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import UnavailableNotice from "./publication/UnavailableNotice";
import NoBreakYear from "./NoBreakYear";
import HouseholdPicker from "./HouseholdPicker";
import useIncomeCurve from "../hooks/useIncomeCurve";
import {
  DEFAULT_HOUSEHOLD,
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
  legendWrapperStyle,
  legendLabelStyle,
  axisWidth,
  CHART_COLOURS,
} from "../utils/chartTheme";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { chartMotion } from "../utils/chartMotion";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

// Chart metadata for export
const CHART_TITLE = "Household net income";

// Legend items for export
const LEGEND_ITEMS = [
  { color: CHART_COLOURS.before, label: "Before the Budget", type: "line" },
  { color: CHART_COLOURS.after, label: "After the Budget", type: "line" },
];

/**
 * An example household's net income before and after the selected
 * policies, across its income grid. The card's own chooser picks the
 * household; App passes one shared choice so both cards show the same one.
 */
function EmploymentIncomeChart({
  selectedPolicies,
  selectedYear = DEFAULT_DISPLAY_YEAR,
  defaultHousehold = DEFAULT_HOUSEHOLD,
  household: controlledHousehold,
  onHouseholdChange,
}) {
  const [ownHousehold, setOwnHousehold] = useState(defaultHousehold);
  // A parent can control the choice so the two household cards stay in step
  const householdId = controlledHousehold ?? ownHousehold;
  const setHouseholdId = onHouseholdChange ?? setOwnHousehold;
  const household = exampleHousehold(householdId);
  const { loading, data: curve, levels } = useIncomeCurve({
    household: household.id,
    year: selectedYear,
    policies: selectedPolicies,
  });
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const chartTitle = `${CHART_TITLE}, ${formatYearRange(selectedYear)}`;

  // Net income levels need the approved package baseline at every point;
  // without it the change chart still shows, but this one is unavailable
  const published = levels;
  const data = published ? curve : [];
  const exportName = `household-net-income-${household.id}-${selectedYear}`;
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
    csv: () => householdIncomeCsv(data, { year: selectedYear, household }),
    published,
  };

  const xTicks = roundTicks(household.x_max);
  const yMax = Math.max(1, ...data.map((point) => Math.max(point.baseline, point.reform)));
  const yTicks = roundTicks(yMax);
  const picker = <HouseholdPicker value={household.id} onChange={setHouseholdId} />;

  if (loading) {
    return (
      <div className="employment-income-chart">
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

  return (
    <div className="employment-income-chart">
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
        {!published && <UnavailableNotice reason="Absolute household income is unavailable. An approved combined package baseline and every selected measure are required." />}
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 420 : 430}>
            <LineChart
              data={data}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
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
                domain={[0, yTicks[yTicks.length - 1]]}
              />

              <Tooltip

                {...TOOLTIP_PROPS}

                content={

                  <ChartTooltip

                    format={formatPounds}

                    labelFormat={(label) => `${household.x_label} ${formatPounds(label)}`}

                    grouped={false}

                  />

                }

              />
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                iconType="line"
                iconSize={18}
                formatter={(value) => (
                  <span style={legendLabelStyle(narrow)}>{value}</span>
                )}
                verticalAlign="bottom"
                align="center"
              />
              <Line
                type="monotone"
                dataKey="baseline"
                stroke={CHART_COLOURS.before}
                strokeWidth={2.5}
                dot={false}
                name="Before the Budget"
                {...chartMotion()}
              />
              <Line
                type="monotone"
                dataKey="reform"
                stroke={CHART_COLOURS.after}
                strokeWidth={2.5}
                strokeDasharray="8 4"
                dot={false}
                name="After the Budget"
                {...chartMotion()}
              />
              <Customized component={<ChartUnitLabel text="Household net income" />} />
            <Customized component={PolicyEngineLogo} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={narrow ? 420 : 430}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default EmploymentIncomeChart;

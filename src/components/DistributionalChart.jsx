import { useMemo, useRef } from "react";
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
  Customized,
  Scatter,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { decileCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import { ALL_POLICY_NAMES, POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import { POLICIES } from "../utils/policies";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  legendLabelStyle,
  axisWidth,
  CHART_COLOURS,
  zeroBasedAxis,
  HOVER_CURSOR,
} from "../utils/chartTheme";
import { DEFAULT_DISPLAY_YEAR, isDisplayYear } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";

// Order for distributional chart: good for households first, then bad
// Every legend uses one order, set in policyConfig: revenue raisers, then
// costs. (A name with no data here is never drawn.)

// Chart metadata for export
const CHART_DESCRIPTION =
  "Change in household net income by income decile, as a share of its net income.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

const decileOrder = [
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
];

// Policies that need sign flip (raise revenue but data shows positive household impact incorrectly)
const FLIP_SIGN_POLICIES = [];

function DistributionalChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const formatPercent = (value) => `${value.toFixed(1)}%`;

  // Remove "st", "nd", "rd", "th" from decile labels
  const formatDecile = (value) => {
    return value.replace(/st|nd|rd|th/g, "");
  };

  // Build chart data for internal year
  // Memoised: a re-render with the same year and policies keeps the same
  // array, so Recharts tweens once from the old year instead of restarting
  const data = useMemo(() => {
    const distributionalSelectedYear = rawData
      ? rawData.filter(
          (row) =>
            parseInt(row.year) === selectedYear &&
            selectedPolicies.includes(row.reform_id),
        )
      : [];

    return decileOrder.map((decile) => {
      const dataPoint = { decile };
      let netChange = 0;
      POLICIES.forEach((policy) => {
        const isSelected = selectedPolicies.includes(policy.id);
        const dataRow = distributionalSelectedYear.find(
          (row) => row.reform_id === policy.id && row.decile === decile,
        );
        let value = isSelected && dataRow ? parseFloat(dataRow.value) : 0;
        // Flip sign for policies with incorrect data sign
        if (FLIP_SIGN_POLICIES.includes(policy.id)) {
          value = -value;
        }
        dataPoint[policy.name] = value;
        netChange += value;
      });
      dataPoint.netChange = netChange;
      return dataPoint;
    });
  }, [rawData, selectedPolicies, selectedYear]);

  // The measures with a non-zero effect in any shown year, not just this
  // one: the legend (and so the plot's height) stays the same from year to
  // year, so a year change or Play tweens the bars instead of rescaling
  const activePolicies = useMemo(() => {
    const ids = new Set(
      (rawData ?? [])
        .filter(
          (row) =>
            isDisplayYear(row.year) &&
            selectedPolicies.includes(row.reform_id) &&
            Math.abs(parseFloat(row.value)) > 0.01,
        )
        .map((row) => row.reform_id),
    );
    return ALL_POLICY_NAMES.filter((name) =>
      ids.has(POLICIES.find((policy) => policy.name === name)?.id),
    );
  }, [rawData, selectedPolicies]);

  // The y axis for the year shown, from the lowest to the highest stack and
  // always including 0 (not mirrored about 0, so no half of the plot is empty)
  const calculateYAxisDomain = () => {
    // The year shown, so the axis fits its bars
    const allYears = [selectedYear];
    let minValue = 0;
    let maxValue = 0;

    allYears.forEach((year) => {
      const yearData = rawData
        ? rawData.filter(
            (row) =>
              parseInt(row.year) === year &&
              selectedPolicies.includes(row.reform_id),
          )
        : [];

      decileOrder.forEach((decile) => {
        let positiveSum = 0;
        let negativeSum = 0;

        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = yearData.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          let value = isSelected && dataRow ? parseFloat(dataRow.value) : 0;
          // Flip sign for policies with incorrect data sign
          if (FLIP_SIGN_POLICIES.includes(policy.id)) {
            value = -value;
          }
          if (value > 0) positiveSum += value;
          else negativeSum += value;
        });

        minValue = Math.min(minValue, negativeSum);
        maxValue = Math.max(maxValue, positiveSum);
      });
    });

    return zeroBasedAxis([minValue, maxValue]);
  };

  const { domain: yAxisDomain, ticks: yAxisTicks } = calculateYAxisDomain();

  if (!rawData || rawData.length === 0) {
    return (
      <div className="distributional-chart">
        <h3>Relative impact by income decile</h3>
        <p className="chart-description">
            {CHART_DESCRIPTION}
        </p>
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: CHART_COLOURS.tick,
            backgroundColor: CHART_COLOURS.mutedFill,
            borderRadius: "8px",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.95rem" }}>
            No data available yet for this metric
          </p>
        </div>
      </div>
    );
  }


  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: name,
      type: "rect",
      group: REVENUE_RAISING_NAMES.has(name) ? "raise" : "cost",
    })),
    ...(activePolicies.length > 1
      ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }]
      : []),
  ];

  const chartTitle = `Relative impact by income decile, ${formatYearRange(selectedYear)}`;

  const published = (rawData ?? []).some(
    (row) => parseInt(row.year) === selectedYear,
  );
  const exportName = `relative-impact-decile-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: CHART_DESCRIPTION,
    legendItems,
    logo: CHART_LOGO,
  };
  const selectedPolicyNames = POLICIES.filter((policy) =>
    selectedPolicies.includes(policy.id),
  ).map((policy) => policy.name);
  // One menu: the chart's data as CSV, and the chart as PNG or SVG.
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: () => decileCsv(data, selectedPolicyNames, { kind: "relative", year: selectedYear }),
    published,
  };

  return (
    <div className="distributional-chart">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="bars" />
            <span className="title-text">
              <NoBreakYear text={chartTitle} />
            </span>
          </h3>
          <p className="chart-description">
            {CHART_DESCRIPTION}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 620 : 480}>
            <ComposedChart
              data={data}
              margin={chartMargin(narrow)}
              stackOffset="sign"
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="decile"
                tickFormatter={formatDecile}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                height={44}
                label={{
                  value: "Income decile",
                  position: "insideBottom",
                  offset: 2,
                  style: AXIS_TITLE_STYLE,
                }}
              />
              <YAxis
                domain={yAxisDomain}
                ticks={yAxisTicks}
                width={axisWidth(yAxisTicks, formatPercent)}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatPercent}
                tick={TICK_STYLE}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />

              <Tooltip

                {...TOOLTIP_PROPS}

                cursor={HOVER_CURSOR}

                content={

                  <ChartTooltip

                    format={(value) => `${value.toFixed(2)}%`}

                    labelFormat={(label) =>
                      `Income decile ${String(label).replace(/st|nd|rd|th/g, "")}, ${formatYearRange(selectedYear)}`
                    }

                    netKey="netChange"

                    netLabel="Net change"

                  />

                }

              />
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                content={
                  <GroupedLegend
                    names={activePolicies}
                    netLabel={activePolicies.length > 1 ? "Net change" : undefined}
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
                // Straight segments: deciles are categories, not a curve
                // A smooth net line that never overshoots its points (monotone)
                type="monotone"
                strokeLinejoin="round"
                strokeLinecap="round"
                dataKey="netChange"
                stroke={CHART_COLOURS.net}
                strokeWidth={2}
                dot={false}
                name="netChange"
                {...chartMotion()}
                hide={activePolicies.length <= 1}
              />
              {/* The net dots as a Scatter: Recharts hides a Line's own dots while
                  it animates, so they would vanish and pop back on every year
                  change; a Scatter's points tween with the line instead */}
              <Scatter
                dataKey="netChange"
                shape={netDot}
                legendType="none"
                tooltipType="none"
                {...chartMotion()}
                hide={activePolicies.length <= 1}
              />
              <Customized component={<ChartUnitLabel text="Change in net income (%)" />} />
            <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={narrow ? 620 : 480}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default DistributionalChart;

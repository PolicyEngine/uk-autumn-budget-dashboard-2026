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
} from "../utils/chartTheme";
import { DISPLAY_YEARS, DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";

// Order for waterfall chart: good for households first, then bad
// Every legend uses one order, set in policyConfig: revenue raisers, then
// costs. (A name with no data here is never drawn.)

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the absolute change in net income by decile, measured in pounds per year. This represents the actual cash amount gained or lost by households in each decile.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
  { id: "threshold_freeze_extension", name: "Threshold freeze extension" },
  { id: "dividend_tax_increase_2pp", name: "Dividend tax increase (+2pp)" },
  {
    id: "savings_tax_increase_2pp",
    name: "Savings income tax increase (+2pp)",
  },
  {
    id: "property_tax_increase_2pp",
    name: "Property income tax increase (+2pp)",
  },
  {
    id: "freeze_student_loan_thresholds",
    name: "Freeze student loan repayment thresholds",
  },
  { id: "salary_sacrifice_cap", name: "Salary sacrifice cap" },
];

const waterfallDeciles = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

// Policies that need sign flip (raise revenue but data shows positive household impact incorrectly)
const FLIP_SIGN_POLICIES = [];

function WaterfallChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  // Build chart data for internal year
  // Memoised: a re-render with the same year and policies keeps the same
  // array, so Recharts tweens once from the old year instead of restarting
  const data = useMemo(() => {
    const waterfallSelectedYear = rawData
      ? rawData.filter(
          (row) =>
            parseInt(row.year) === selectedYear &&
            row.decile !== "all" &&
            selectedPolicies.includes(row.reform_id),
        )
      : [];

    return waterfallDeciles.map((decile) => {
      const dataPoint = { decile };
      let netChange = 0;
      POLICIES.forEach((policy) => {
        const isSelected = selectedPolicies.includes(policy.id);
        const dataRow = waterfallSelectedYear.find(
          (row) => row.reform_id === policy.id && row.decile === decile,
        );
        let value = isSelected && dataRow ? parseFloat(dataRow.avg_change) : 0;
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

  // Calculate y-axis domain across ALL years, symmetrical around zero
  const calculateYAxisDomain = () => {
    const allYears = DISPLAY_YEARS;
    let minValue = 0;
    let maxValue = 0;

    allYears.forEach((year) => {
      const yearData = rawData
        ? rawData.filter(
            (row) =>
              parseInt(row.year) === year &&
              row.decile !== "all" &&
              selectedPolicies.includes(row.reform_id),
          )
        : [];

      waterfallDeciles.forEach((decile) => {
        let positiveSum = 0;
        let negativeSum = 0;

        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = yearData.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          let value =
            isSelected && dataRow ? parseFloat(dataRow.avg_change) : 0;
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

    // Round to nice numbers and make symmetrical
    const roundToNice = (val) => {
      if (val <= 500) return Math.ceil(val / 100) * 100;
      if (val <= 2000) return Math.ceil(val / 500) * 500;
      return Math.ceil(val / 1000) * 1000;
    };

    const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue)) + 50;
    const rounded = roundToNice(maxAbs);

    return [-rounded, rounded];
  };

  const yAxisDomain = calculateYAxisDomain();

  if (!rawData || rawData.length === 0) {
    return (
      <div className="waterfall-chart">
        <h3>Absolute impact by income decile</h3>
        <p className="chart-description">
          This chart shows the absolute change in net income by decile, measured
          in pounds per year.
        </p>
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: "#666",
            backgroundColor: "#f9f9f9",
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

  const formatCurrency = (value) => {
    const absVal = Math.abs(value).toLocaleString("en-GB", {
      maximumFractionDigits: 0,
    });
    return value < 0 ? `-£${absVal}` : `£${absVal}`;
  };

  // Check which policies have non-zero values
  const hasNonZeroValues = (policyName) => {
    return data.some((d) => Math.abs(d[policyName] || 0) > 0.01);
  };

  const activePolicies = ALL_POLICY_NAMES.filter(hasNonZeroValues);

  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: name,
      type: "rect",
      group: REVENUE_RAISING_NAMES.has(name) ? "raise" : "cost",
    })),
    ...(activePolicies.length > 1
      ? [{ color: "#000000", label: "Net change", type: "line" }]
      : []),
  ];

  const chartTitle = `Absolute impact by income decile, ${formatYearRange(selectedYear)}`;

  const published = (rawData ?? []).some(
    (row) => parseInt(row.year) === selectedYear,
  );
  const exportName = `absolute-impact-decile-${selectedYear}`;
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
    csv: () => decileCsv(data, selectedPolicyNames, { kind: "absolute", year: selectedYear }),
    published,
  };

  return (
    <div className="waterfall-chart">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            This chart shows the absolute change in net income by decile,
            measured in pounds per year. This represents the actual cash amount
            gained or lost by households in each decile.
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
                tickFormatter={formatCurrency}
                tick={TICK_STYLE}
                width={axisWidth(yAxisDomain, formatCurrency)}
                axisLine={false}
                tickLine={false}
                ticks={(() => {
                  const [min, max] = yAxisDomain;
                  const range = max - min;
                  let interval = 100;
                  if (range > 1000) interval = 250;
                  if (range > 2000) interval = 500;
                  if (range > 5000) interval = 1000;
                  const ticks = [];
                  for (let i = min; i <= max + 0.001; i += interval) {
                    ticks.push(Math.round(i));
                  }
                  if (!ticks.includes(0)) ticks.push(0);
                  return ticks.sort((a, b) => a - b);
                })()}
              />
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />

              <Tooltip

                {...TOOLTIP_PROPS}

                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}

                content={

                  <ChartTooltip

                    format={(value) => `£${Math.round(value).toLocaleString("en-GB")}`}

                    labelFormat={(label) => `Income decile ${label}`}

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
                type="linear"
                dataKey="netChange"
                stroke="#000000"
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
              <Customized component={<ChartUnitLabel text="Average change per household (£)" />} />
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

export default WaterfallChart;

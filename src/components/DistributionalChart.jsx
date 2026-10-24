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
  Customized,
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
import { DISPLAY_YEARS } from "../utils/displayYears";

// Order for distributional chart: good for households first, then bad
// Every legend uses one order, set in policyConfig: revenue raisers, then
// costs. (A name with no data here is never drawn.)

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the percentage change in net income by decile, displaying the proportional impact relative to baseline income. Positive values indicate gains; negative values indicate losses.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

function DistributionalChart({ rawData, selectedPolicies, selectedYear = 2029 }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const formatPercent = (value) => `${value.toFixed(1)}%`;

  // Remove "st", "nd", "rd", "th" from decile labels
  const formatDecile = (value) => {
    return value.replace(/st|nd|rd|th/g, "");
  };

  // Build chart data for internal year
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
  const distributionalSelectedYear = rawData
    ? rawData.filter(
        (row) =>
          parseInt(row.year) === selectedYear &&
          selectedPolicies.includes(row.reform_id),
      )
    : [];

  // Policies that need sign flip (raise revenue but data shows positive household impact incorrectly)
  const FLIP_SIGN_POLICIES = [];

  const data = decileOrder.map((decile) => {
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

    // Round to nice numbers and make symmetrical
    const roundToNice = (val) => {
      if (val <= 1) return Math.ceil(val * 2) / 2; // Round to 0.5
      if (val <= 5) return Math.ceil(val); // Round to 1
      return Math.ceil(val / 2) * 2; // Round to 2
    };

    const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue)) + 0.2;
    const rounded = roundToNice(maxAbs);

    return [-rounded, rounded];
  };

  const yAxisDomain = calculateYAxisDomain();

  if (!rawData || rawData.length === 0) {
    return (
      <div className="distributional-chart">
        <h3>Relative impact by income decile</h3>
        <p className="chart-description">
          This chart shows the percentage change in net income by decile,
          displaying the proportional impact relative to baseline income.
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

  // Check which policies have non-zero values
  const hasNonZeroValues = (policyName) => {
    return data.some((d) => Math.abs(d[policyName] || 0) > 0.0001);
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
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            This chart shows the percentage change in net income by decile,
            displaying the proportional impact relative to baseline income.
            Positive values indicate gains; negative values indicate losses.
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 620 : 500}>
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
                width={axisWidth(yAxisDomain, formatPercent)}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatPercent}
                tick={TICK_STYLE}
                ticks={(() => {
                  const [min, max] = yAxisDomain;
                  const range = max - min;
                  let interval = 0.5;
                  if (range > 4) interval = 1;
                  if (range > 10) interval = 2;
                  const ticks = [];
                  for (let i = min; i <= max + 0.001; i += interval) {
                    ticks.push(Math.round(i * 10) / 10);
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

                    format={(value) => `${value.toFixed(2)}%`}

                    labelFormat={(label) => `Income decile ${String(label).replace(/st|nd|rd|th/g, "")}`}

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
                  animationDuration={500}
                  animationBegin={0}
                  hide={!hasNonZeroValues(policyName)}
                />
              ))}
              <Line
                // Straight segments: deciles are categories, not a curve
                type="linear"
                dataKey="netChange"
                stroke="#000000"
                strokeWidth={2}
                dot={{ fill: "#000000", stroke: "#ffffff", strokeWidth: 1.5, r: 3.5 }}
                name="netChange"
                animationDuration={500}
                hide={activePolicies.length <= 1}
              />
              <Customized component={<ChartUnitLabel text="Change in net income (%)" />} />
            <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={narrow ? 620 : 500}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default DistributionalChart;

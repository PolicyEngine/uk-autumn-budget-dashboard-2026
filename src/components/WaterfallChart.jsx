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
import { buildChartSvg, exportChartAsSvg } from "../utils/exportChartAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { decileCsv, unpublishedCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import { ALL_POLICY_NAMES, POLICY_COLORS } from "../utils/policyConfig";
import "./WaterfallChart.css";
import "./ChartExport.css";
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
  axisWidth,
} from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";

// Order for waterfall chart: good for households first, then bad
// Every legend uses one order, set in policyConfig: revenue raisers, then
// costs. (A name with no data here is never drawn.)

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the absolute change in net income by decile, measured in pounds per year. This represents the actual cash amount gained or lost by households in each decile.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

function WaterfallChart({ rawData, selectedPolicies, selectedYear = 2029 }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

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

  const waterfallDeciles = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const waterfallSelectedYear = rawData
    ? rawData.filter(
        (row) =>
          parseInt(row.year) === selectedYear &&
          row.decile !== "all" &&
          selectedPolicies.includes(row.reform_id),
      )
    : [];

  // Policies that need sign flip (raise revenue but data shows positive household impact incorrectly)
  const FLIP_SIGN_POLICIES = [];

  const data = waterfallDeciles.map((decile) => {
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
  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, exportName, exportOptions);
  };
  const selectedPolicyNames = POLICIES.filter((policy) =>
    selectedPolicies.includes(policy.id),
  ).map((policy) => policy.name);
  // One menu: the chart's data as CSV, and the SVG export as SVG or PNG.
  const downloads = {
    csv: () =>
      downloadFile(
        published
          ? decileCsv(data, selectedPolicyNames, { kind: "absolute", year: selectedYear })
          : unpublishedCsv(decileCsv(data, selectedPolicyNames, { kind: "absolute", year: selectedYear })),
        `${exportName}.csv`,
        "text/csv;charset=utf-8",
      ),
    png: async () =>
      downloadSvgAsPng(await buildChartSvg(chartRef, exportOptions), exportName),
    svg: handleExportSvg,
  };
  // A year not yet published has only its (empty) CSV to download
  if (!published) {
    delete downloads.png;
    delete downloads.svg;
  }

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
        <ChartDownloadMenu formats={downloads} chartTitle={chartTitle} />
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
                formatter={(value, name) => [
                  formatCurrency(value),
                  name === "netChange" ? "Net change" : name,
                ]}
                labelFormatter={(label) => `Decile: ${label}`}
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

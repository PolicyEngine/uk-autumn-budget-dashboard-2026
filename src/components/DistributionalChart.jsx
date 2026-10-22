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
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import { POLICY_COLORS } from "../utils/policyConfig";
import "./DistributionalChart.css";
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
} from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";

// Order for distributional chart: good for households first, then bad
const ALL_POLICY_NAMES = [
  // Good for households (positive, teal/green)
  "2 child limit repeal",
  "Fuel duty freeze extension",
  "Rail fares freeze",
  // Bad for households (negative, amber)
  "Threshold freeze extension",
  "Dividend tax increase (+2pp)",
  "Savings income tax increase (+2pp)",
  "Property income tax increase (+2pp)",
  "Freeze student loan repayment thresholds",
  "NICs on salary sacrifice (>£2k)",
];

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
    { id: "salary_sacrifice_cap", name: "NICs on salary sacrifice (>£2k)" },
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
          ? decileCsv(data, selectedPolicyNames, { kind: "relative", year: selectedYear })
          : unpublishedCsv(decileCsv(data, selectedPolicyNames, { kind: "relative", year: selectedYear })),
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
        <ChartDownloadMenu formats={downloads} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 620 : 480}>
            <ComposedChart
              data={data}
              margin={chartMargin(narrow, { left: 64 })}
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
                width={narrow ? 52 : 60}
                axisLine={false}
                tickLine={false}
                label={
                  narrow
                    ? undefined
                    : {
                        value: "Percentage change in net income (%)",
                        angle: -90,
                        position: "insideLeft",
                        dx: -16,
                        style: AXIS_TITLE_STYLE,
                      }
                }
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
                formatter={(value, name) => [
                  formatPercent(value),
                  name === "netChange" ? "Net change" : name,
                ]}
                labelFormatter={(label) => `${label} decile`}
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
                  <span style={legendLabelStyle(narrow)}>{value}</span>
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
                          value: "Net change",
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
                dataKey="netChange"
                stroke="#000000"
                strokeWidth={2}
                dot={{ fill: "#000000", stroke: "#ffffff", strokeWidth: 1.5, r: 3.5 }}
                name="netChange"
                animationDuration={500}
                hide={activePolicies.length <= 1}
              />
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

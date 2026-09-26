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
import { exportChartAsSvg } from "../utils/exportChartAsSvg";
import { POLICY_COLORS, CHART_POLICIES, ALL_POLICY_NAMES } from "../utils/policyConfig";
import "./DistributionalChart.css";
import "./ChartExport.css";

// Order for distributional chart: good for households first, then bad

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the percentage change in modelled household resources by decile, relative to baseline income. Bus fare savings are an imputed service benefit, not cash income.";

const formatYearRange = (year) => String(year);

function DistributionalChart({ rawData, selectedPolicies, selectedYear = 2029 }) {
  const chartRef = useRef(null);

  const formatPercent = (value) => `${value.toFixed(1)}%`;

  // Remove "st", "nd", "rd", "th" from decile labels
  const formatDecile = (value) => {
    return value.replace(/st|nd|rd|th/g, "");
  };

  // Build chart data for internal year

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
    CHART_POLICIES.forEach((policy) => {
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
    const allYears = [2026, 2027, 2028, 2029, 2030];
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

        CHART_POLICIES.forEach((policy) => {
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
        <h2>Relative impact by income decile</h2>
        <p className="chart-description">
          This chart shows the percentage change in modelled household resources
          by decile. Bus fare savings are an imputed service benefit.
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

  // Build legend items for export - include ALL policies for consistency across exports
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

  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, "distributional-impact", {
      title: chartTitle,
      description: CHART_DESCRIPTION,
      legendItems,
      logo: CHART_LOGO,
    });
  };

  return (
    <div className="distributional-chart">
      <div className="chart-header">
        <div>
          <h2>{chartTitle}</h2>
          <p className="chart-description">
            This chart shows the percentage change in modelled household
            resources by decile, relative to baseline income. The bus fare
            scenario includes an imputed service benefit, not cash income.
          </p>
        </div>
        <button
          className="export-button"
          onClick={handleExportSvg}
          title="Download as SVG"
          aria-label="Download chart as SVG"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart
            data={data}
            margin={{ top: 20, right: 30, left: 70, bottom: 20 }}
            stackOffset="sign"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="decile"
              tickFormatter={formatDecile}
              tick={{ fontSize: 12, fill: "#666" }}
              label={{
                value: "Income decile",
                position: "insideBottom",
                offset: -10,
                style: { fill: "#374151", fontSize: 12, fontWeight: 500 },
              }}
            />
            <YAxis
              domain={yAxisDomain}
              label={{
                value: "Percentage change in net income (%)",
                angle: -90,
                position: "insideLeft",
                dx: -30,
                style: {
                  textAnchor: "middle",
                  fill: "#374151",
                  fontSize: 13,
                  fontWeight: 500,
                },
              }}
              tickFormatter={formatPercent}
              tick={{ fontSize: 12, fill: "#666" }}
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
            <ReferenceLine y={0} stroke="#666" strokeWidth={1} />
            <Tooltip
              formatter={(value, name) => [
                formatPercent(value),
                name === "netChange" ? "Net change" : name,
              ]}
              labelFormatter={(label) => `${label} decile`}
              contentStyle={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
              }}
              wrapperStyle={{
                top: "-120px",
                left: "50%",
                transform: "translateX(-50%)",
              }}
              cursor={{ fill: "rgba(49, 151, 149, 0.1)" }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "20px", paddingRight: "140px" }}
              iconType="rect"
              formatter={(value) => (
                <span
                  style={{
                    color: "#374151",
                    fontSize: "13px",
                    fontWeight: 500,
                  }}
                >
                  {value}
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
                        value: "Net change",
                        type: "line",
                        color: "#000000",
                      },
                    ]
                  : []),
              ]}
            />
            {activePolicies.map((policyName) => (
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
              strokeWidth={3}
              dot={{ fill: "#000000", stroke: "#000000", strokeWidth: 1, r: 3 }}
              name="netChange"
              animationDuration={500}
              hide={activePolicies.length <= 1}
            />
            <Customized component={PolicyEngineLogo} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default DistributionalChart;

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
import { exportChartAsSvg } from "../utils/exportChartAsSvg";
import { POLICY_COLORS, ALL_POLICY_NAMES } from "../utils/policyConfig";
import "./BudgetaryImpactChart.css";
import "./ChartExport.css";

// Custom label component for net impact values
const NetImpactLabel = (props) => {
  const { x, y, value } = props;

  const formattedValue =
    value < 0 ? `-£${Math.abs(value).toFixed(1)}bn` : `+£${value.toFixed(1)}bn`;
  const yOffset = value >= 0 ? -20 : 28;

  return (
    <g>
      {/* White background for readability */}
      <rect
        x={x - 32}
        y={y + yOffset - 10}
        width={64}
        height={18}
        fill="white"
        rx={3}
        ry={3}
        stroke="#000000"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y + yOffset}
        fill="#000000"
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {formattedValue}
      </text>
    </g>
  );
};

// Chart metadata for export
const CHART_TITLE = "Revenue impact";
const CHART_DESCRIPTION =
  "This chart shows the annual budgetary impact from 2026 to 2030, measured in billions of pounds. Positive values indicate revenue gains for the Government, whilst negative values indicate costs to the Treasury.";

function BudgetaryImpactChart({ data }) {
  const chartRef = useRef(null);

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

  const largestStack = Math.max(1, ...data.map((row) =>
    activePolicies.reduce((sum, name) => sum + Math.max(0, row[name] || 0), 0),
  ));
  const smallestStack = Math.min(-1, ...data.map((row) =>
    activePolicies.reduce((sum, name) => sum + Math.min(0, row[name] || 0), 0),
  ));
  const yAxisDomain = [
    -Math.ceil(Math.abs(smallestStack) / 5) * 5,
    Math.ceil(largestStack / 5) * 5,
  ];

  // Build legend items for export - include ALL policies for consistency across exports
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

  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, "revenue-impact", {
      title: CHART_TITLE,
      description: CHART_DESCRIPTION,
      legendItems,
      logo: CHART_LOGO,
    });
  };

  return (
    <div className="budgetary-impact-chart">
      <div className="chart-header">
        <div>
          <h2>Revenue impact</h2>
          <p className="chart-description">
            This chart shows the annual budgetary impact from 2026 to 2030,
            measured in billions of pounds. Positive values indicate revenue
            gains for the Government, whilst negative values indicate costs to
            the Treasury.
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
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart
            data={data}
            margin={{ top: 15, right: 20, left: 70, bottom: 15 }}
            stackOffset="sign"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: "#666" }}
              tickFormatter={(year) => `${year}-${(year + 1).toString().slice(-2)}`}
            />
            <YAxis
              domain={yAxisDomain}
              label={{
                value: "Impact (£bn)",
                angle: -90,
                position: "insideLeft",
                dx: -30,
                style: {
                  textAnchor: "middle",
                  fill: "#374151",
                  fontSize: 12,
                  fontWeight: 500,
                },
              }}
              tickFormatter={formatCurrencyTick}
              tick={{ fontSize: 11, fill: "#666" }}
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
              labelFormatter={(year) => `${year}-${(year + 1).toString().slice(-2)}`}
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
              dataKey="netImpact"
              stroke="#000000"
              strokeWidth={3}
              dot={{ fill: "#000000", stroke: "#000000", strokeWidth: 1, r: 3 }}
              name="netImpact"
              animationDuration={500}
              hide={activePolicies.length <= 1}
              label={activePolicies.length > 1 ? <NetImpactLabel /> : false}
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

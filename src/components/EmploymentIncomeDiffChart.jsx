import { useState, useEffect, useRef } from "react";
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
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { exportChartAsSvg } from "../utils/exportChartAsSvg";
import "./EmploymentIncomeDiffChart.css";
import "./ChartExport.css";

const formatYearRange = (year) => String(year);

// Chart metadata for export
const CHART_TITLE = "Net income change";
const getChartDescription = () =>
  `This chart shows the change in modelled resources for a London household with 2 adults (both age 40) and 3 children (ages 7, 5, and 3). The primary earner contributes £10,000 annually to their pension. The household has £10,000 in annual capital gains before responses, £1,200 in petrol spending and £800 in bus fares. The £2 bus cap does not apply to London.`;

// Legend items for export
const LEGEND_ITEMS = [
  { color: "#319795", label: "Gain", type: "rect" },
  { color: "#D97706", label: "Loss", type: "rect" },
];

function EmploymentIncomeDiffChart({ selectedPolicies, selectedYear = 2029 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef(null);

  const chartTitle = `Net income change, ${formatYearRange(selectedYear)}`;

  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, "net-income-change", {
      title: chartTitle,
      description: getChartDescription(),
      legendItems: LEGEND_ITEMS,
      logo: CHART_LOGO,
    });
  };

  useEffect(() => {
    // Load income curve data from CSV
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/income_curve.csv`)
      .then((response) => response.text())
      .then((csvText) => {
        const lines = csvText.trim().split("\n");
        const headers = lines[0].split(",");

        // Parse all income curve data
        const allData = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",");
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index];
          });
          allData.push(row);
        }

        // Filter by selected year
        const yearFilteredData = allData.filter(
          (row) => parseInt(row.year) === selectedYear,
        );

        // Get unique employment income values (up to 100k)
        const employmentIncomes = [
          ...new Set(
            yearFilteredData
              .filter((row) => parseFloat(row.employment_income) <= 100000)
              .map((row) => parseFloat(row.employment_income)),
          ),
        ].sort((a, b) => a - b);

        // Build chart data: for each employment income, compute the difference
        const chartData = employmentIncomes.map((income) => {
          // Get baseline from any row (it's the same across reforms)
          const baselineRow = yearFilteredData.find(
            (row) => parseFloat(row.employment_income) === income,
          );
          const baseline = baselineRow
            ? parseFloat(baselineRow.baseline_net_income)
            : 0;

          // Sum up the income changes from each selected policy
          let totalIncomeChange = 0;
          selectedPolicies.forEach((policyId) => {
            const policyRow = yearFilteredData.find(
              (row) =>
                row.reform_id === policyId &&
                parseFloat(row.employment_income) === income,
            );
            if (policyRow) {
              const reformIncome = parseFloat(policyRow.reform_net_income);
              const baselineIncome = parseFloat(policyRow.baseline_net_income);
              totalIncomeChange += reformIncome - baselineIncome;
            }
          });

          return {
            employment: income,
            difference: totalIncomeChange,
            positive: totalIncomeChange >= 0 ? totalIncomeChange : null,
            negative: totalIncomeChange <= 0 ? totalIncomeChange : null,
          };
        });

        setData(chartData);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error loading income curve data:", error);
        setLoading(false);
      });
  }, [selectedPolicies, selectedYear]);

  const formatCurrency = (value) => {
    const absVal = Math.abs(value);
    if (absVal >= 1000) {
      const formatted = `£${(absVal / 1000).toFixed(0)}k`;
      return value < 0 ? `-${formatted}` : formatted;
    }
    const formatted = `£${absVal.toFixed(0)}`;
    return value < 0 ? `-${formatted}` : formatted;
  };

  if (loading) {
    return (
      <div className="employment-income-diff-chart">
        <h2>{chartTitle}</h2>
        <p className="chart-description">
          This chart shows the change in household net income for a household
          with 2 adults (both age 40) and 3 children (ages 7, 5, and 3). The
          primary earner contributes £10,000 annually to their pension. This illustrative household has £10,000 in annual capital gains before responses, £1,200 in petrol spending and £800 in bus fares.
        </p>
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          Loading income curve data...
        </div>
      </div>
    );
  }

  // Calculate symmetric y-axis domain
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.difference)));
  const yMax = Math.ceil(maxAbs / 1000) * 1000 || 1000;

  // Check if there are any non-null positive or negative values
  const hasPositive = data.some((d) => d.positive !== null && d.positive > 0);
  const hasNegative = data.some((d) => d.negative !== null && d.negative < 0);

  return (
    <div className="employment-income-diff-chart">
      <div className="chart-header">
        <div>
          <h2>{chartTitle}</h2>
          <p className="chart-description">
            This chart shows the change in household net income for a household
            with 2 adults (both age 40) and 3 children (ages 7, 5, and 3). The
            primary earner contributes £10,000 annually to their pension. This illustrative London household has £10,000 in annual capital gains before responses, £1,200 in petrol spending and £800 in bus fares. The £2 bus cap does not apply to London.
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
        <ResponsiveContainer width="100%" height={430}>
          <AreaChart
            data={data}
            margin={{ top: 25, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="employment"
              type="number"
              label={{
                value: "Household head employment income",
                position: "insideBottom",
                offset: -5,
                style: {
                  textAnchor: "middle",
                  fill: "#374151",
                  fontSize: 13,
                  fontWeight: 500,
                },
              }}
              tickFormatter={formatCurrency}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              height={60}
              ticks={[0, 20000, 40000, 60000, 80000, 100000]}
              domain={[0, 100000]}
            />
            <YAxis
              label={{
                value: "Change in net income",
                angle: -90,
                position: "insideLeft",
                dx: 10,
                style: {
                  textAnchor: "middle",
                  fill: "#374151",
                  fontSize: 13,
                  fontWeight: 500,
                },
              }}
              tickFormatter={formatCurrency}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              width={80}
              domain={[-yMax, yMax]}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(value),
                "Income change",
              ]}
              labelFormatter={(label) =>
                `Employment income: ${formatCurrency(label)}`
              }
              contentStyle={{
                background: "white",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                padding: "12px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              }}
              labelStyle={{ fontWeight: 600, marginBottom: "4px" }}
            />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            {hasPositive && (
              <Area
                type="monotone"
                dataKey="positive"
                stroke="#319795"
                strokeWidth={2}
                fill="#319795"
                fillOpacity={0.6}
                baseValue={0}
                connectNulls={false}
                animationDuration={500}
                animationBegin={0}
              />
            )}
            {hasNegative && (
              <Area
                type="monotone"
                dataKey="negative"
                stroke="#D97706"
                strokeWidth={2}
                fill="#D97706"
                fillOpacity={0.6}
                baseValue={0}
                connectNulls={false}
                animationDuration={500}
                animationBegin={0}
              />
            )}
            <Customized component={PolicyEngineLogo} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default EmploymentIncomeDiffChart;

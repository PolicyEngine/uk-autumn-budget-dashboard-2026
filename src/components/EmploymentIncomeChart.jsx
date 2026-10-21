import { useState, useEffect, useRef } from "react";
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
import { buildChartSvg, exportChartAsSvg } from "../utils/exportChartAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { householdIncomeCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import "./EmploymentIncomeChart.css";
import "./ChartExport.css";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  legendWrapperStyle,
  legendLabelStyle,
  TOOLTIP_CONTENT_STYLE,
} from "../utils/chartTheme";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

// Chart metadata for export
const CHART_TITLE = "Household net income analysis";
const getChartDescription = (year) =>
  `This chart models a household with 2 adults (both age 40) and 3 children (ages 7, 5, and 3) in ${formatYearRange(year)}. The primary earner contributes £10,000 annually to their pension. Pre-Autumn Budget shows policy without reforms, Post-Autumn Budget shows impact after selected changes.`;

// Legend items for export
const LEGEND_ITEMS = [
  { color: "#9CA3AF", label: "Pre-Autumn Budget", type: "line" },
  { color: "#319795", label: "Post-Autumn Budget", type: "line" },
];

function EmploymentIncomeChart({ selectedPolicies, selectedYear = 2029 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const chartTitle = `Household net income analysis, ${formatYearRange(selectedYear)}`;

  const exportName = `household-net-income-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: getChartDescription(selectedYear),
    legendItems: LEGEND_ITEMS,
    logo: CHART_LOGO,
  };
  const handleExportSvg = async () => {
    await exportChartAsSvg(chartRef, exportName, exportOptions);
  };
  // One menu: the chart's data as CSV, and the SVG export as SVG or PNG.
  const downloads = {
    csv: () =>
      downloadFile(
        householdIncomeCsv(data, { year: selectedYear }),
        `${exportName}.csv`,
        "text/csv;charset=utf-8",
      ),
    png: async () =>
      downloadSvgAsPng(await buildChartSvg(chartRef, exportOptions), exportName),
    svg: handleExportSvg,
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

        // Build chart data: for each employment income, compute baseline and combined reform
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
            baseline: baseline,
            reform: baseline + totalIncomeChange,
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
    if (value >= 1000) {
      return `£${(value / 1000).toFixed(0)}k`;
    }
    return `£${value.toFixed(0)}`;
  };

  if (loading) {
    return (
      <div className="employment-income-chart">
        <h2>{chartTitle}</h2>
        <p className="chart-description">
          This chart shows the relationship between household head employment
          income and total household net income in {formatYearRange(selectedYear)}.
        </p>
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          Loading income curve data...
        </div>
      </div>
    );
  }

  return (
    <div className="employment-income-chart">
      <div className="chart-header">
        <div>
          <h2>{chartTitle}</h2>
          <p className="chart-description">
            This chart models a household with 2 adults (both age 40) and 3
            children (ages 7, 5, and 3) in {formatYearRange(selectedYear)}. The primary earner
            contributes £10,000 annually to their pension. Pre-Autumn Budget shows
            policy without reforms, Post-Autumn Budget shows impact after selected changes.
          </p>
        </div>
        <ChartDownloadMenu formats={downloads} />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 420 : 430}>
          <LineChart
            data={data}
            margin={
              narrow
                ? { top: 12, right: 20, left: 0, bottom: 8 }
                : { top: 16, right: 24, left: 8, bottom: 8 }
            }
          >
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="employment"
              type="number"
              axisLine={AXIS_LINE}
              tickLine={false}
              label={{
                value: "Household head employment income",
                position: "insideBottom",
                offset: 4,
                style: AXIS_TITLE_STYLE,
              }}
              tickFormatter={formatCurrency}
              tick={TICK_STYLE}
              height={48}
              ticks={[0, 20000, 40000, 60000, 80000, 100000]}
              domain={[0, 100000]}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              label={
                narrow
                  ? undefined
                  : {
                      value: "Household net income",
                      angle: -90,
                      position: "insideLeft",
                      dx: 6,
                      style: AXIS_TITLE_STYLE,
                    }
              }
              tickFormatter={formatCurrency}
              tick={TICK_STYLE}
              width={narrow ? 52 : 76}
              ticks={[0, 20000, 40000, 60000, 80000]}
              domain={[0, 80000]}
            />
            <Tooltip
              formatter={(value) => formatCurrency(value)}
              labelFormatter={(label) =>
                `Employment income: ${formatCurrency(label)}`
              }
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={{ fontWeight: 600, marginBottom: "4px" }}
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
              stroke="#9CA3AF"
              strokeWidth={2.5}
              dot={false}
              name="Pre-Autumn Budget"
              animationDuration={500}
              animationBegin={0}
            />
            <Line
              type="monotone"
              dataKey="reform"
              stroke="#319795"
              strokeWidth={2.5}
              strokeDasharray="8 4"
              dot={false}
              name="Post-Autumn Budget"
              animationDuration={500}
              animationBegin={0}
            />
            <Customized component={PolicyEngineLogo} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default EmploymentIncomeChart;

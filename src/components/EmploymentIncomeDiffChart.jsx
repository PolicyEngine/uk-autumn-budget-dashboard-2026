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
import { buildChartSvg, exportChartAsSvg } from "../utils/exportChartAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { householdChangeCsv, unpublishedCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import "./EmploymentIncomeDiffChart.css";
import "./ChartExport.css";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  TOOLTIP_CONTENT_STYLE,
  axisWidth,
} from "../utils/chartTheme";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

// Chart metadata for export
const CHART_TITLE = "Net income change";
const getChartDescription = () =>
  "Change in net income from the selected policies, by the main earner's pay.";

// Legend items for export
const LEGEND_ITEMS = [
  { color: "#319795", label: "Gain", type: "rect" },
  { color: "#D97706", label: "Loss", type: "rect" },
];

function EmploymentIncomeDiffChart({ selectedPolicies, selectedYear = 2029 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();

  const chartTitle = `Net income change, ${formatYearRange(selectedYear)}`;

  // The income curve file covers this year only if it has rows for it
  const published = data.length > 0;
  const exportName = `net-income-change-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: getChartDescription(),
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
        published
          ? householdChangeCsv(data, { year: selectedYear })
          : unpublishedCsv(householdChangeCsv(data, { year: selectedYear })),
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
        <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
        <p className="chart-description">
          Change in net income from the selected policies, by the main
          earner's pay.
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
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            Change in net income from the selected policies, by the main
            earner's pay.
          </p>
        </div>
        <ChartDownloadMenu formats={downloads} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 380 : 430}>
            <AreaChart
              data={data}
              margin={
                narrow
                  ? { top: 24, right: 16, left: 0, bottom: 34 }
                  : // Bottom space matches the legend (and logo row) of the
                    // chart beside it, so the two x-axes line up.
                    { top: 24, right: 16, left: 0, bottom: 68 }
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
                tickFormatter={formatCurrency}
                tick={TICK_STYLE}
                width={axisWidth([-yMax, yMax], formatCurrency)}
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
                contentStyle={TOOLTIP_CONTENT_STYLE}
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
              <Customized component={<ChartUnitLabel text="Change in net income" />} />
            <Customized component={PolicyEngineLogo} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={narrow ? 380 : 430}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default EmploymentIncomeDiffChart;

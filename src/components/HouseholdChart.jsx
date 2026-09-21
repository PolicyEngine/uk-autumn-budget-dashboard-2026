import { useMemo, useState, useRef, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Customized,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { exportChartAsSvg } from "../utils/exportChartAsSvg";
import "./HouseholdChart.css";
import "./ChartExport.css";

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart plots net income change against baseline income for 500 sampled households. Green dots indicate gains, amber shows losses, and grey shows minimal change. Dot opacity represents household weight in the population.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

// Legend items for export
const LEGEND_ITEMS = [
  { color: "#319795", label: "Gains", type: "rect" },
  { color: "#D97706", label: "Losses", type: "rect" },
  { color: "#9CA3AF", label: "No change", type: "rect" },
];

function HouseholdChart({ rawData, selectedPolicies, selectedYear = 2029 }) {
  // Use prop for year selection (shared slider in parent)

  // Zoom state
  const [zoomDomain, setZoomDomain] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const chartRef = useRef(null);
  const exportRef = useRef(null);
  const startPoint = useRef(null);

  const chartTitle = `Household income impacts, ${formatYearRange(selectedYear)}`;

  const handleExportSvg = async () => {
    await exportChartAsSvg(exportRef, "household-impacts", {
      title: chartTitle,
      description: CHART_DESCRIPTION,
      legendItems: LEGEND_ITEMS,
      logo: CHART_LOGO,
    });
  };

  // Process pre-sampled data from backend (no frontend sampling needed)
  // Backend samples the SAME 500 households across all reforms for consistency
  // Uses household_id to match households across reforms
  const data = useMemo(() => {
    if (!rawData) return [];

    // Group data by reform_id, year, and household_id for easy lookup
    const dataByReformYearHousehold = {};
    rawData.forEach((row) => {
      const reformId = row.reform_id;
      const year = parseInt(row.year);
      const householdId = row.household_id;

      if (!selectedPolicies.includes(reformId)) return;

      if (!dataByReformYearHousehold[reformId]) {
        dataByReformYearHousehold[reformId] = {};
      }
      if (!dataByReformYearHousehold[reformId][year]) {
        dataByReformYearHousehold[reformId][year] = {};
      }

      dataByReformYearHousehold[reformId][year][householdId] = {
        baseline_income: parseFloat(row.baseline_income),
        income_change: parseFloat(row.income_change),
        household_weight: parseFloat(row.household_weight),
        household_id: householdId,
      };
    });

    // Find household IDs that exist in ALL years (for consistent animation)
    const years = [2026, 2027, 2028, 2029, 2030];
    let householdIdsInAllYears = null;

    selectedPolicies.forEach((reformId) => {
      years.forEach((year) => {
        const yearData = dataByReformYearHousehold[reformId]?.[year] || {};
        const idsThisYear = new Set(Object.keys(yearData));
        if (householdIdsInAllYears === null) {
          householdIdsInAllYears = idsThisYear;
        } else {
          // Intersect: keep only IDs present in all years
          householdIdsInAllYears = new Set(
            [...householdIdsInAllYears].filter((id) => idsThisYear.has(id))
          );
        }
      });
    });

    const allHouseholdIds = householdIdsInAllYears || new Set();

    if (allHouseholdIds.size === 0) return [];

    // Combine income changes from all selected policies for each household
    const filteredData = [];
    allHouseholdIds.forEach((householdId) => {
      let combinedIncomeChange = 0;
      let baselineIncome = 0;
      let householdWeight = 0;
      let foundInAnyPolicy = false;
      const policyBreakdown = {}; // Store change per policy

      // Sum income changes from all selected policies for this household
      selectedPolicies.forEach((reformId) => {
        const householdData =
          dataByReformYearHousehold[reformId]?.[selectedYear]?.[householdId];
        if (householdData) {
          foundInAnyPolicy = true;
          combinedIncomeChange += householdData.income_change;
          // Store non-zero changes for tooltip breakdown
          if (Math.abs(householdData.income_change) > 0.01) {
            policyBreakdown[reformId] = householdData.income_change;
          }
          // Baseline income and weight should be the same across policies
          if (baselineIncome === 0) {
            baselineIncome = householdData.baseline_income;
            householdWeight = householdData.household_weight;
          }
        }
      });

      // Only add if we found this household in at least one policy
      if (foundInAnyPolicy && (baselineIncome > 0 || combinedIncomeChange !== 0)) {
        filteredData.push({
          baseline_income: baselineIncome,
          income_change: combinedIncomeChange,
          household_weight: householdWeight,
          household_id: householdId,
          year: selectedYear,
          policyBreakdown, // Include breakdown for tooltip
        });
      }
    });

    return filteredData;
  }, [rawData, selectedPolicies, selectedYear]);

  // Process data for Recharts
  const { chartData, stats, dataExtent } = useMemo(() => {
    if (!data || data.length === 0)
      return { chartData: [], stats: null, dataExtent: null };

    // Data is already sampled consistently across years

    // Calculate statistics
    const gains = data.filter((d) => d.income_change > 0.01);
    const losses = data.filter((d) => d.income_change < -0.01);
    const noChange = data.filter((d) => Math.abs(d.income_change) <= 0.01);

    // Scale household weights for marker sizes (4-15 range for better visibility)
    const maxWeight = data.reduce(
      (max, d) => Math.max(max, d.household_weight),
      0,
    );
    const scaleSize = (weight) =>
      Math.max(4, Math.min(15, (weight / maxWeight) * 15));

    // Scale household weights for opacity (0.5-0.95 range for better visibility)
    const scaleOpacity = (weight) =>
      Math.max(0.5, Math.min(0.95, 0.5 + (weight / maxWeight) * 0.45));

    // Calculate data extent for zoom
    const xValues = data.map((d) => d.income_change);
    const yValues = data.map((d) => d.baseline_income);
    const extent = {
      xMin: xValues.reduce((min, val) => Math.min(min, val), Infinity),
      xMax: xValues.reduce((max, val) => Math.max(max, val), -Infinity),
      yMin: yValues.reduce((min, val) => Math.min(min, val), Infinity),
      yMax: yValues.reduce((max, val) => Math.max(max, val), -Infinity),
    };

    // Prepare data with category, size, and opacity
    const processedData = data.map((d) => ({
      x: d.income_change,
      y: d.baseline_income,
      size: scaleSize(d.household_weight),
      opacity: scaleOpacity(d.household_weight),
      category:
        d.income_change > 0.01
          ? "gains"
          : d.income_change < -0.01
            ? "losses"
            : "noChange",
      weight: d.household_weight,
      householdId: d.household_id,
      policyBreakdown: d.policyBreakdown || {},
    }));

    return {
      chartData: processedData,
      stats: {
        gains: gains.length,
        losses: losses.length,
        noChange: noChange.length,
        total: data.length,
      },
      dataExtent: extent,
    };
  }, [data]);

  // Calculate domains (either zoomed or full)
  const { xDomain, yDomain } = useMemo(() => {
    if (!dataExtent) return { xDomain: [0, 0], yDomain: [0, 0] };

    if (zoomDomain) {
      return zoomDomain;
    }

    // Fixed axes that cover all data across all years
    return {
      xDomain: [-5000, 5000],
      yDomain: [0, 150000],
    };
  }, [dataExtent, zoomDomain]);

  // Convert pixel coordinates to data coordinates
  const pixelToData = useCallback(
    (pixelX, pixelY, chartArea) => {
      if (!chartArea) return null;

      const { x: chartX, y: chartY, width, height } = chartArea;

      // Calculate relative position within chart
      const relX = (pixelX - chartX) / width;
      const relY = (pixelY - chartY) / height;

      // Convert to data coordinates
      const dataX = xDomain[0] + relX * (xDomain[1] - xDomain[0]);
      const dataY = yDomain[1] - relY * (yDomain[1] - yDomain[0]); // Y is inverted

      return { x: dataX, y: dataY };
    },
    [xDomain, yDomain],
  );

  // Mouse event handlers for drag zoom
  const handleMouseDown = useCallback((e) => {
    if (!chartRef.current) return;

    const chartArea = chartRef.current.getBoundingClientRect();
    const x = e.clientX - chartArea.left;
    const y = e.clientY - chartArea.top;

    // Check if click is within the chart area (approximate margins)
    const margin = { left: 80, right: 30, top: 20, bottom: 60 };
    if (
      x < margin.left ||
      x > chartArea.width - margin.right ||
      y < margin.top ||
      y > chartArea.height - margin.bottom
    ) {
      return;
    }

    startPoint.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    setSelectionBox(null);
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging || !startPoint.current || !chartRef.current) return;

      const chartArea = chartRef.current.getBoundingClientRect();
      const currentX = e.clientX - chartArea.left;
      const currentY = e.clientY - chartArea.top;
      const startX = startPoint.current.x - chartArea.left;
      const startY = startPoint.current.y - chartArea.top;

      setSelectionBox({
        left: Math.min(startX, currentX),
        top: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(
    (e) => {
      if (!isDragging || !startPoint.current || !chartRef.current) {
        setIsDragging(false);
        setSelectionBox(null);
        return;
      }

      const chartArea = chartRef.current.getBoundingClientRect();

      // Get chart content area (excluding margins)
      const margin = { left: 80, right: 30, top: 20, bottom: 60 };
      const contentArea = {
        x: margin.left,
        y: margin.top,
        width: chartArea.width - margin.left - margin.right,
        height: chartArea.height - margin.top - margin.bottom,
      };

      const start = pixelToData(startPoint.current.x, startPoint.current.y, {
        x: chartArea.left + contentArea.x,
        y: chartArea.top + contentArea.y,
        width: contentArea.width,
        height: contentArea.height,
      });

      const end = pixelToData(e.clientX, e.clientY, {
        x: chartArea.left + contentArea.x,
        y: chartArea.top + contentArea.y,
        width: contentArea.width,
        height: contentArea.height,
      });

      if (start && end) {
        const minDragDistance = 10;
        const dragDistance = Math.sqrt(
          Math.pow(e.clientX - startPoint.current.x, 2) +
            Math.pow(e.clientY - startPoint.current.y, 2),
        );

        if (dragDistance > minDragDistance) {
          setZoomDomain({
            xDomain: [Math.min(start.x, end.x), Math.max(start.x, end.x)],
            yDomain: [Math.min(start.y, end.y), Math.max(start.y, end.y)],
          });
        }
      }

      setIsDragging(false);
      setSelectionBox(null);
      startPoint.current = null;
    },
    [isDragging, pixelToData],
  );

  // Zoom control functions
  const handleZoomIn = () => {
    if (!xDomain || !yDomain) return;

    const xCenter = (xDomain[0] + xDomain[1]) / 2;
    const yCenter = (yDomain[0] + yDomain[1]) / 2;
    const xRange = (xDomain[1] - xDomain[0]) / 1.5;
    const yRange = (yDomain[1] - yDomain[0]) / 1.5;

    setZoomDomain({
      xDomain: [xCenter - xRange / 2, xCenter + xRange / 2],
      yDomain: [yCenter - yRange / 2, yCenter + yRange / 2],
    });
  };

  const handleZoomOut = () => {
    if (!xDomain || !yDomain || !dataExtent) return;

    const xCenter = (xDomain[0] + xDomain[1]) / 2;
    const yCenter = (yDomain[0] + yDomain[1]) / 2;
    const xRange = (xDomain[1] - xDomain[0]) * 1.5;
    const yRange = (yDomain[1] - yDomain[0]) * 1.5;

    const newXDomain = [xCenter - xRange / 2, xCenter + xRange / 2];
    const newYDomain = [yCenter - yRange / 2, yCenter + yRange / 2];

    // Don't zoom out beyond the initial view
    const maxXDomain = [-5000, 5000];
    const maxYDomain = [0, 150000];

    if (
      newXDomain[0] <= maxXDomain[0] &&
      newXDomain[1] >= maxXDomain[1] &&
      newYDomain[0] <= maxYDomain[0] &&
      newYDomain[1] >= maxYDomain[1]
    ) {
      setZoomDomain(null); // Reset to full view
    } else {
      setZoomDomain({
        xDomain: newXDomain,
        yDomain: newYDomain,
      });
    }
  };

  const handleResetZoom = () => {
    setZoomDomain(null);
  };

  // Policy name mapping for tooltip
  const policyNames = {
    two_child_limit: "2 child limit repeal",
    fuel_duty_freeze: "Fuel duty freeze",
    rail_fares_freeze: "Rail fares freeze",
    threshold_freeze_extension: "Threshold freeze",
    dividend_tax_increase_2pp: "Dividend tax +2pp",
    savings_tax_increase_2pp: "Savings tax +2pp",
    property_tax_increase_2pp: "Property tax +2pp",
    freeze_student_loan_thresholds: "Student loan freeze",
    salary_sacrifice_cap: "Salary sacrifice cap",
    autumn_budget_2026_combined: "Autumn Budget (combined)",
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const formatValue = (val) => {
        const absVal = Math.abs(val).toLocaleString("en-GB", {
          maximumFractionDigits: 0,
        });
        return val < 0 ? `-£${absVal}` : `£${absVal}`;
      };

      // Get policy breakdown entries (non-zero only)
      const breakdownEntries = Object.entries(data.policyBreakdown || {});

      return (
        <div
          style={{
            backgroundColor: "white",
            padding: "10px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontSize: "12px",
            maxWidth: "280px",
          }}
        >
          <p style={{ margin: "2px 0", color: "#374151" }}>
            <strong>Household income:</strong> {formatValue(data.y)}
          </p>
          <p style={{ margin: "2px 0 6px 0", color: "#374151" }}>
            <strong>Total change:</strong> {formatValue(data.x)}
          </p>
          {breakdownEntries.length > 0 && (
            <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "6px" }}>
              <p style={{ margin: "0 0 4px 0", color: "#666", fontSize: "11px" }}>
                Breakdown by policy:
              </p>
              {breakdownEntries.map(([policyId, change]) => (
                <p
                  key={policyId}
                  style={{
                    margin: "2px 0",
                    color: change > 0 ? "#319795" : "#D97706",
                    fontSize: "11px",
                  }}
                >
                  {policyNames[policyId] || policyId}: {formatValue(change)}
                </p>
              ))}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Color mapping
  const getColor = (category) => {
    switch (category) {
      case "gains":
        return "#319795";
      case "losses":
        return "#D97706";
      case "noChange":
        return "#9CA3AF";
      default:
        return "#9CA3AF";
    }
  };

  if (!data || data.length === 0) {
    return (
      <div className="household-chart">
        <h2>Household income impacts</h2>
        <p className="chart-description">
          This chart plots net income change for each household against their
          baseline income. Points above zero represent gains; points below
          represent losses.
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

  return (
    <div className="household-chart">
      <div className="chart-header">
        <div>
          <h2>{chartTitle}</h2>
          <p className="chart-description">
            This chart plots net income change against baseline income for 500
            sampled households. Green dots indicate gains, amber shows losses, and
            grey shows minimal change. Dot opacity represents household weight
            in the population.
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

      <div ref={exportRef}>
        <div
          style={{
            position: "relative",
            cursor: isDragging ? "crosshair" : "default",
          }}
          ref={chartRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Zoom controls */}
          <div className="household-zoom-controls">
            <button
              className="zoom-control-btn"
              onClick={handleZoomIn}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="10"
                  cy="10"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M10 7V13M7 10H13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M15 15L20 20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className="zoom-control-btn"
              onClick={handleZoomOut}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="10"
                  cy="10"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M7 10H13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M15 15L20 20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className="zoom-control-btn"
              onClick={handleResetZoom}
              title="Reset zoom"
              aria-label="Reset zoom"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M21 3V8H16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Selection box overlay */}
          {selectionBox && (
            <div
              className="selection-box"
              style={{
                position: "absolute",
                left: `${selectionBox.left}px`,
                top: `${selectionBox.top}px`,
                width: `${selectionBox.width}px`,
                height: `${selectionBox.height}px`,
                border: "2px dashed #319795",
                backgroundColor: "rgba(49, 151, 149, 0.1)",
                pointerEvents: "none",
                zIndex: 5,
              }}
            />
          )}

          <ResponsiveContainer width="100%" height={500}>
            <ScatterChart margin={{ top: 20, right: 30, left: 80, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />

              <XAxis
                type="number"
                dataKey="x"
                name="Income change"
                domain={xDomain}
                allowDataOverflow={true}
                ticks={[-5000, -2500, 0, 2500, 5000]}
                tickFormatter={(value) => value / 1000}
                tick={{ fontSize: 11, fill: "#666" }}
                label={{
                  value: "Net income change (£k)",
                  position: "bottom",
                  offset: 40,
                  style: { fontSize: 12, fill: "#374151" },
                }}
              />

              <YAxis
                type="number"
                dataKey="y"
                name="Baseline income"
                domain={yDomain}
                allowDataOverflow={true}
                ticks={[0, 20000, 40000, 60000, 80000, 100000, 120000, 140000]}
                tickFormatter={(value) => value / 1000}
                tick={{ fontSize: 11, fill: "#666" }}
                label={{
                  value: "Household net income (£k)",
                  angle: -90,
                  position: "insideLeft",
                  dx: -35,
                  style: {
                    textAnchor: "middle",
                    fontSize: 12,
                    fill: "#374151",
                  },
                }}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{ strokeDasharray: "3 3" }}
              />

              {/* Zero line - fixed at x=0 (no income change) */}
              <ReferenceLine
                x={0}
                stroke="#666"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />

              {/* Single scatter with colored cells based on category */}
              <Scatter
                data={chartData}
                fill="#319795"
                isAnimationActive={true}
                animationDuration={800}
                animationEasing="ease-out"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={`cell-${entry.householdId}`}
                    fill={getColor(entry.category)}
                    fillOpacity={entry.opacity}
                    strokeWidth={0}
                  />
                ))}
              </Scatter>
              <Customized component={PolicyEngineLogo} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}

export default HouseholdChart;

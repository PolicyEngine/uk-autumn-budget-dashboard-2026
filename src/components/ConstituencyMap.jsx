import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import { CHART_LOGO } from "../utils/chartLogo";
import { exportMapAsSvg } from "../utils/exportMapAsSvg";
import "./ConstituencyMap.css";
import "./ChartExport.css";

// Chart metadata for export
const CHART_TITLE = "Constituency-level impacts";
const CHART_DESCRIPTION =
  "This map shows the average annual change in household net income across all 650 UK constituencies. Green shading indicates gains, amber indicates losses, measured as a percentage of baseline income.";

// Fixed color scale extent - consistent across all years
// Based on actual data range: min -0.80%, max +0.73% across all reforms/years
// Using 1% as a nice round number that covers all values
const FIXED_COLOR_EXTENT = 1;

// Mapping from reform_id to display name
const REFORM_NAMES = {
  two_child_limit: "2 child limit repeal",
  fuel_duty_freeze: "Fuel duty freeze extension",
  rail_fares_freeze: "Rail fares freeze",
  threshold_freeze_extension: "Threshold freeze extension",
  dividend_tax_increase_2pp: "Dividend tax increase (+2pp)",
  savings_tax_increase_2pp: "Savings tax increase (+2pp)",
  property_tax_increase_2pp: "Property tax increase (+2pp)",
  freeze_student_loan_thresholds: "Student loan threshold freeze",
  salary_sacrifice_cap: "Salary sacrifice NICs cap",
  autumn_budget_2026_combined: "Autumn Budget 2026 (combined)",
};

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

export default function ConstituencyMap({ selectedPolicies = [], selectedYear = 2029 }) {
  // Use prop for year selection (shared slider in parent)
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const [selectedConstituency, setSelectedConstituency] = useState(null);
  const [tooltipData, setTooltipData] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [rawData, setRawData] = useState([]);
  const [geoData, setGeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/constituency.csv`).then((r) => r.text()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/uk_constituencies_2024.geojson`).then((r) => r.json()),
    ])
      .then(([csvText, geojson]) => {
        // Parse CSV with proper handling of quoted fields
        const parseCSVLine = (line) => {
          const result = [];
          let current = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              result.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current.trim());
          return result;
        };

        const lines = csvText.split("\n");
        const headers = parseCSVLine(lines[0]);
        const parsedData = lines
          .slice(1)
          .filter((line) => line.trim())
          .map((line) => {
            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((header, idx) => {
              row[header] = values[idx]?.trim();
            });

            return {
              reform_id: row.reform_id,
              year: parseInt(row.year) || 2026,
              constituency_code: row.constituency_code,
              constituency_name: row.constituency_name?.replace(/^"|"$/g, ""),
              average_gain: parseFloat(row.average_gain) || 0,
              relative_change: parseFloat(row.relative_change) || 0,
            };
          });

        setRawData(parsedData);
        setGeoData(geojson);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error loading data:", error);
        setLoading(false);
      });
  }, []);

  // Aggregate data across selected policies
  const aggregatedData = useMemo(() => {
    if (!rawData.length || !selectedPolicies.length) return [];

    // Group by constituency and sum values across selected policies
    const constituencyMap = new Map();

    rawData.forEach((row) => {
      if (!selectedPolicies.includes(row.reform_id)) return;
      if (row.year !== selectedYear) return;

      const key = row.constituency_code;
      if (!constituencyMap.has(key)) {
        constituencyMap.set(key, {
          constituency_code: row.constituency_code,
          constituency_name: row.constituency_name,
          average_gain: 0,
          relative_change: 0,
          // Track per-policy breakdown
          policyBreakdown: {},
        });
      }

      const existing = constituencyMap.get(key);
      existing.average_gain += row.average_gain;
      existing.relative_change += row.relative_change;

      // Store individual policy contribution
      existing.policyBreakdown[row.reform_id] = {
        average_gain: row.average_gain,
        relative_change: row.relative_change,
      };
    });

    return Array.from(constituencyMap.values());
  }, [rawData, selectedPolicies, selectedYear]);

  // Render map
  useEffect(() => {
    if (!svgRef.current || !geoData || !aggregatedData.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = 600;

    const g = svg.append("g");

    // Get bounds of the British National Grid coordinates
    const bounds = {
      xMin: Infinity,
      xMax: -Infinity,
      yMin: Infinity,
      yMax: -Infinity,
    };

    geoData.features.forEach((feature) => {
      const coords = feature.geometry?.coordinates;
      if (!coords) return;

      const traverse = (c) => {
        if (typeof c[0] === "number") {
          bounds.xMin = Math.min(bounds.xMin, c[0]);
          bounds.xMax = Math.max(bounds.xMax, c[0]);
          bounds.yMin = Math.min(bounds.yMin, c[1]);
          bounds.yMax = Math.max(bounds.yMax, c[1]);
        } else {
          c.forEach(traverse);
        }
      };
      traverse(coords);
    });

    // Create scale to fit British National Grid coordinates into SVG
    const padding = 20;
    const dataWidth = bounds.xMax - bounds.xMin;
    const dataHeight = bounds.yMax - bounds.yMin;
    const scale = Math.min(
      (width - 2 * padding) / dataWidth,
      (height - 2 * padding) / dataHeight,
    );

    // Calculate centering offsets
    const scaledWidth = dataWidth * scale;
    const scaledHeight = dataHeight * scale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    const projection = d3.geoTransform({
      point: function (x, y) {
        // Transform British National Grid to SVG coordinates
        this.stream.point(
          (x - bounds.xMin) * scale + offsetX,
          height - ((y - bounds.yMin) * scale + offsetY),
        );
      },
    });

    const path = d3.geoPath().projection(projection);

    const dataMap = new Map(
      aggregatedData.map((d) => [d.constituency_code, d]),
    );

    // Color scale - diverging with white at 0, amber for losses, teal for gains
    // Use relative_change (percentage of constituency's average income)
    const getValue = (d) => d.relative_change;

    // Custom interpolator: amber -> light grey -> teal (matching chart palette)
    // Use fixed extent so colors are consistent across all years
    const colorScale = d3
      .scaleDiverging()
      .domain([-FIXED_COLOR_EXTENT, 0, FIXED_COLOR_EXTENT])
      .interpolator((t) => {
        if (t < 0.5) {
          // Amber to grey (losses to zero)
          const ratio = t * 2; // 0 to 1
          return d3.interpolateRgb("#D97706", "#E5E7EB")(ratio);
        } else {
          // Grey to teal (zero to gains)
          const ratio = (t - 0.5) * 2; // 0 to 1
          return d3.interpolateRgb("#E5E7EB", "#14B8A6")(ratio);
        }
      });

    // Draw constituencies
    const paths = g
      .selectAll("path")
      .data(geoData.features)
      .join("path")
      .attr("d", path)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.05)
      .attr("class", "constituency-path")
      .style("cursor", "pointer");

    // Animate fill colors
    paths
      .transition()
      .duration(500)
      .attr("fill", (d) => {
        const constData = dataMap.get(d.properties.GSScode);
        return constData ? colorScale(getValue(constData)) : "#ddd";
      });

    // Add event handlers (must be on selection, not transition)
    paths
      .on("click", function (event, d) {
        event.stopPropagation();

        const constData = dataMap.get(d.properties.GSScode);

        if (constData) {
          // Update styling for all paths
          svg
            .selectAll(".constituency-path")
            .attr("stroke", "#fff")
            .attr("stroke-width", 0.05);

          // Highlight selected constituency
          d3.select(this).attr("stroke", "#1D4044").attr("stroke-width", 0.6);

          setSelectedConstituency(constData);

          // Get centroid of constituency for tooltip positioning
          const bounds = path.bounds(d);
          const centerX = (bounds[0][0] + bounds[1][0]) / 2;
          const centerY = (bounds[0][1] + bounds[1][1]) / 2;

          // Show tooltip
          setTooltipData(constData);
          setTooltipPosition({ x: centerX, y: centerY });

          // Smooth zoom to constituency
          const dx = bounds[1][0] - bounds[0][0];
          const dy = bounds[1][1] - bounds[0][1];
          const x = (bounds[0][0] + bounds[1][0]) / 2;
          const y = (bounds[0][1] + bounds[1][1]) / 2;
          const scale = Math.min(4, 0.9 / Math.max(dx / width, dy / height));
          const translate = [width / 2 - scale * x, height / 2 - scale * y];

          svg
            .transition()
            .duration(750)
            .call(
              zoom.transform,
              d3.zoomIdentity
                .translate(translate[0], translate[1])
                .scale(scale),
            );
        }
      })
      .on("mouseover", function () {
        const currentStrokeWidth = d3.select(this).attr("stroke-width");
        if (currentStrokeWidth === "0.05") {
          d3.select(this).attr("stroke", "#666").attr("stroke-width", 0.3);
        }
      })
      .on("mouseout", function () {
        const currentStrokeWidth = d3.select(this).attr("stroke-width");
        if (currentStrokeWidth !== "0.6") {
          d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.05);
        }
      });

    // Zoom behavior
    const zoom = d3
      .zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Store zoom behavior for controls
    window.mapZoomBehavior = { svg, zoom };

    // Add PolicyEngine logo in bottom-right corner (outside the zoomable group)
    svg
      .append("image")
      .attr("href", CHART_LOGO.href)
      .attr("width", CHART_LOGO.width)
      .attr("height", CHART_LOGO.height)
      .attr("x", width - CHART_LOGO.width - CHART_LOGO.padding)
      .attr("y", height - CHART_LOGO.height - CHART_LOGO.padding);
  }, [geoData, aggregatedData]);

  // Handle search
  useEffect(() => {
    if (!searchQuery.trim() || !aggregatedData.length) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results = aggregatedData
      .filter((d) => d.constituency_name.toLowerCase().includes(query))
      .slice(0, 5);

    setSearchResults(results);
  }, [searchQuery, aggregatedData]);

  // Zoom control functions
  const handleZoomIn = () => {
    if (window.mapZoomBehavior) {
      const { svg, zoom } = window.mapZoomBehavior;
      svg.transition().duration(300).call(zoom.scaleBy, 1.5);
    }
  };

  const handleZoomOut = () => {
    if (window.mapZoomBehavior) {
      const { svg, zoom } = window.mapZoomBehavior;
      svg.transition().duration(300).call(zoom.scaleBy, 0.67);
    }
  };

  const handleResetZoom = () => {
    if (window.mapZoomBehavior) {
      const { svg, zoom } = window.mapZoomBehavior;
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    }
    setTooltipData(null);
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg
        .selectAll(".constituency-path")
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.05);
    }
  };

  const selectConstituency = (constData) => {
    setSelectedConstituency(constData);
    setSearchQuery("");
    setSearchResults([]);

    if (!geoData || !svgRef.current) return;

    const svg = d3.select(svgRef.current);

    // Update styling for all paths
    svg
      .selectAll(".constituency-path")
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.05);

    // Highlight selected constituency
    const selectedPath = svg
      .selectAll(".constituency-path")
      .filter((d) => d.properties.GSScode === constData.constituency_code);

    selectedPath.attr("stroke", "#1D4044").attr("stroke-width", 0.6);

    // Get the bounding box of the selected path
    const pathNode = selectedPath.node();
    if (!pathNode) return;

    const bbox = pathNode.getBBox();
    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;

    // Show tooltip
    setTooltipData(constData);
    setTooltipPosition({ x: centerX, y: centerY });

    // Smooth zoom to constituency
    const dx = bbox.width;
    const dy = bbox.height;
    const x = centerX;
    const y = centerY;
    const scale = Math.min(4, 0.9 / Math.max(dx / 800, dy / 500));
    const translate = [800 / 2 - scale * x, 500 / 2 - scale * y];

    if (window.mapZoomBehavior) {
      const { svg: svgZoom, zoom } = window.mapZoomBehavior;
      svgZoom
        .transition()
        .duration(750)
        .call(
          zoom.transform,
          d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale),
        );
    }
  };

  const handleExportSvg = async () => {
    if (!svgRef.current) return;

    await exportMapAsSvg(svgRef.current, `constituency-map-${selectedYear}`, {
      title: `${CHART_TITLE}, ${formatYearRange(selectedYear)}`,
      description: CHART_DESCRIPTION,
      logo: CHART_LOGO,
      tooltipData,
    });
  };

  if (loading) {
    return <div className="constituency-loading">Loading map...</div>;
  }

  // Don't render if no policy is selected or no aggregated data
  if (!selectedPolicies.length || !aggregatedData.length) {
    return null;
  }

  return (
    <div className="constituency-map-wrapper">
      {/* Header section */}
      <div className="map-header">
        <div className="chart-header">
          <div>
            <h2>Constituency-level impacts, {formatYearRange(selectedYear)}</h2>
            <p className="chart-description">
              This map shows the average annual change in household net income
              across all 650 UK constituencies. Green shading indicates gains,
              amber indicates losses, measured as a percentage of baseline income.
            </p>
          </div>
          <button
            className="export-button"
            onClick={handleExportSvg}
            title="Download as SVG"
            aria-label="Download map as SVG"
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
      </div>

      {/* Search and legend in top bar */}
      <div className="map-top-bar">
        <div className="map-search-section">
          <h3>Search constituency</h3>
          <div className="search-container">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type to search..."
              className="constituency-search"
            />
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((result) => (
                  <button
                    key={result.constituency_code}
                    onClick={() => selectConstituency(result)}
                    className="search-result-item"
                  >
                    <div className="result-name">
                      {result.constituency_name}
                    </div>
                    <div className="result-value">
                      £{result.average_gain.toFixed(0)} (
                      {result.relative_change.toFixed(2)}%)
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="map-legend-horizontal">
          <div className="legend-horizontal-content">
            <div className="legend-gradient-horizontal" />
            <div className="legend-labels-horizontal">
              <span>-{FIXED_COLOR_EXTENT}%</span>
              <span className="legend-zero">0%</span>
              <span>+{FIXED_COLOR_EXTENT}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Map full width */}
      <div className="map-content">
        <div className="map-canvas">
          <svg
            ref={svgRef}
            width="800"
            height="568"
            viewBox="0 0 800 600"
            preserveAspectRatio="xMidYMid meet"
            onClick={() => {
              setTooltipData(null);
              if (svgRef.current) {
                const svg = d3.select(svgRef.current);
                svg
                  .selectAll(".constituency-path")
                  .attr("stroke", "#fff")
                  .attr("stroke-width", 0.05);
              }
            }}
          />

          {/* Map controls */}
          <div
            className="map-controls-container"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Zoom controls */}
            <div className="zoom-controls">
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
          </div>

          {/* Tooltip overlay */}
          {tooltipData && (
            <div
              className="constituency-tooltip"
              style={{
                left: `${tooltipPosition.x}px`,
                top: `${tooltipPosition.y}px`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="tooltip-close"
                onClick={() => setTooltipData(null)}
              >
                ×
              </div>
              <h4>{tooltipData.constituency_name}</h4>
              <p
                className="tooltip-value"
                style={{
                  color: tooltipData.average_gain >= 0 ? "#16a34a" : "#dc2626",
                }}
              >
                {tooltipData.average_gain < 0 ? "-" : ""}£
                {Math.abs(tooltipData.average_gain).toLocaleString("en-GB", {
                  maximumFractionDigits: 0,
                })}
              </p>
              <p className="tooltip-label">Average household impact</p>
              <p
                className="tooltip-value-secondary"
                style={{
                  color:
                    tooltipData.relative_change >= 0 ? "#16a34a" : "#dc2626",
                }}
              >
                {tooltipData.relative_change >= 0 ? "+" : ""}
                {tooltipData.relative_change.toFixed(2)}%
              </p>
              <p className="tooltip-label">Relative change</p>

              {/* Policy breakdown - only show if multiple policies selected */}
              {tooltipData.policyBreakdown &&
                Object.keys(tooltipData.policyBreakdown).length > 1 && (
                  <div className="tooltip-breakdown">
                    <p className="tooltip-breakdown-header">By provision:</p>
                    {Object.entries(tooltipData.policyBreakdown)
                      .sort((a, b) => b[1].average_gain - a[1].average_gain)
                      .map(([reformId, data]) => (
                        <div key={reformId} className="tooltip-breakdown-row">
                          <span className="tooltip-breakdown-name">
                            {REFORM_NAMES[reformId] || reformId}
                          </span>
                          <span
                            className="tooltip-breakdown-value"
                            style={{
                              color:
                                data.average_gain >= 0 ? "#16a34a" : "#dc2626",
                            }}
                          >
                            {data.average_gain < 0 ? "-" : ""}£
                            {Math.abs(data.average_gain).toLocaleString(
                              "en-GB",
                              { maximumFractionDigits: 0 }
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

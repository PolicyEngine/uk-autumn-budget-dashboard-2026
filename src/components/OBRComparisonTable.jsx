import React, { useState, useEffect } from "react";
import "./OBRComparisonTable.css";
import "./ViewSwitch.css";
import PillSelect from "./PillSelect";
import { DISPLAY_YEARS, DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import OBRDumbbellChart from "./OBRDumbbellChart";

/** What the comparison says while the OBR has not costed the selected measures. */
export const OBR_UNAVAILABLE =
  "Shown once the OBR publishes its costings for these measures.";

function OBRComparisonTable({ selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const [comparisonData, setComparisonData] = useState(null);
  // Static by default: like for like with PolicyEngine's static estimates
  const [showBehavioural, setShowBehavioural] = useState(false);
  // The comparison shows as a chart or as a table, never both
  const [view, setView] = useState("chart");
  const showTable = view === "table";

  useEffect(() => {
    // Fetch both OBR comparison data and PolicyEngine budgetary impact data
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/obr_comparison.csv`).then((res) => res.text()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/budgetary_impact.csv`).then((res) => res.text()),
    ])
      .then(([obrCsvText, peCsvText]) => {
        // Parse OBR data
        const obrLines = obrCsvText.trim().split("\n");
        const obrHeaders = obrLines[0].split(",");
        const staticIdx = obrHeaders.indexOf("obr_static_value");
        const behaviouralIdx = obrHeaders.indexOf("obr_post_behavioural_value");

        const obrData = {};
        for (let i = 1; i < obrLines.length; i++) {
          const values = obrLines[i].split(",");
          const reform_id = values[0];
          const year = parseInt(values[2]);
          const key = `${reform_id}_${year}`;
          obrData[key] = {
            reform_id,
            reform_name: values[1],
            year,
            obr_static: staticIdx >= 0 ? parseFloat(values[staticIdx]) : null,
            obr_behavioural:
              behaviouralIdx >= 0 ? parseFloat(values[behaviouralIdx]) : null,
          };
        }

        // Parse PolicyEngine budgetary impact data
        const peLines = peCsvText.trim().split("\n");
        const peHeaders = peLines[0].split(",");
        const reformIdIdx = peHeaders.indexOf("reform_id");
        const reformNameIdx = peHeaders.indexOf("reform_name");
        const yearIdx = peHeaders.indexOf("year");
        const valueIdx = peHeaders.indexOf("value");

        for (let i = 1; i < peLines.length; i++) {
          const values = peLines[i].split(",");
          const reform_id = values[reformIdIdx];
          const year = parseInt(values[yearIdx]);
          const pe_value = parseFloat(values[valueIdx]);
          const key = `${reform_id}_${year}`;

          // A year the OBR didn't cost (2031-32): PolicyEngine's figure,
          // with the OBR's left blank ("—")
          if (!obrData[key]) {
            obrData[key] = {
              reform_id,
              reform_name: values[reformNameIdx],
              year,
              obr_static: null,
              obr_behavioural: null,
            };
          }
          obrData[key].policyengine_value = pe_value;
        }

        // Convert to array
        const data = Object.values(obrData);
        setComparisonData(data);
      })
      .catch((err) => console.error("Error loading comparison data:", err));
  }, []);

  if (!comparisonData || selectedPolicies.length === 0) return null;

  // Filter to selected policies
  const filteredData = comparisonData.filter((row) =>
    selectedPolicies.includes(row.reform_id),
  );

  if (filteredData.length === 0) return null;

  // The OBR's costings are joined by measure id. Until it costs these
  // measures (with the Budget on 28 October), none has an OBR figure, so
  // nothing is paired: the comparison says when it will be available.
  const hasObrFigures = filteredData.some(
    (row) => Number.isFinite(row.obr_static) || Number.isFinite(row.obr_behavioural),
  );
  if (!hasObrFigures) {
    return (
      <div className="obr-comparison-section">
        <p className="comparison-description obr-unavailable">
          {OBR_UNAVAILABLE}
        </p>
      </div>
    );
  }

  // Check if we have both static and behavioural data
  const hasBothTypes = filteredData.some(
    (row) => row.obr_static !== null && row.obr_behavioural !== null,
  );

  // Group by policy
  const policiesMap = {};
  filteredData.forEach((row) => {
    if (!policiesMap[row.reform_id]) {
      policiesMap[row.reform_id] = {
        name: row.reform_name,
        years: {},
      };
    }
    policiesMap[row.reform_id].years[row.year] = {
      policyengine: row.policyengine_value,
      obr_static: row.obr_static,
      obr_behavioural: row.obr_behavioural,
    };
  });

  // Every year shown; a year the file does not cover reads "—"
  const years = DISPLAY_YEARS;
  const policies = Object.entries(policiesMap);

  // Signed with a true minus; a value that rounds to zero reads "£0.0bn"
  const formatValue = (value) => {
    if (value === null || value === undefined || isNaN(value)) return "—";
    const rounded = Math.abs(value).toFixed(1);
    const sign = value < 0 && rounded !== "0.0" ? "\u2212" : "";
    return `${sign}£${rounded}bn`;
  };

  const getDifferenceClass = (pe, obr) => {
    if (pe === null || obr === null || isNaN(pe) || isNaN(obr)) return "";
    const diff = Math.abs(pe - obr);
    if (diff < 0.5) return "diff-small";
    if (diff < 2) return "diff-medium";
    return "diff-large";
  };

  const getObrValue = (yearData) => {
    if (showBehavioural && yearData.obr_behavioural !== null) {
      return yearData.obr_behavioural;
    }
    if (!showBehavioural && yearData.obr_static !== null) {
      return yearData.obr_static;
    }
    // Fallback to whichever is available
    return yearData.obr_behavioural ?? yearData.obr_static;
  };

  return (
    <div className="obr-comparison-section">
      {/* Intro across the full width; the controls sit below it */}
      <div className="obr-intro-row">
        <p className="comparison-description">
          PolicyEngine's static estimates against the OBR's November 2025
          costings (
          <a
            href="https://obr.uk/efo/economic-and-fiscal-outlook-november-2025/"
            target="_blank"
            rel="noopener noreferrer"
          >
            EFO
          </a>
          ), £bn a year; positive values raise revenue.
        </p>
      </div>

      <div className="obr-controls">
        {hasBothTypes && (
          <PillSelect
            variant="light"
            name="OBR basis"
            prefix="OBR basis"
            value={showBehavioural ? "post" : "static"}
            onChange={(value) => setShowBehavioural(value === "post")}
            options={[
              { value: "static", label: "Static" },
              { value: "post", label: "Post-behavioural" },
            ]}
          />
        )}
        <div className="obr-view-switch" role="group" aria-label="Show as">
          <button
            type="button"
            className="obr-view-option"
            aria-pressed={!showTable}
            aria-label="Chart"
            title="Chart"
            onClick={() => setView("chart")}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2 14h12M4 11V7M8 11V3M12 11V6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <span>Chart</span>
          </button>
          <button
            type="button"
            className="obr-view-option"
            aria-pressed={showTable}
            aria-label="Table"
            title="Table"
            onClick={() => setView("table")}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.75h11M6.5 3v10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span>Table</span>
          </button>
        </div>
      </div>

      {!showTable && (
        <OBRDumbbellChart
          policies={policies}
          year={selectedYear}
          showBehavioural={showBehavioural}
        />
      )}

      {/* The table and its key replace the chart when "Table" is chosen */}
      <div
        id="obr-comparison-table"
        className="comparison-table-wrapper"
        hidden={!showTable}
      >
        <table className="comparison-table">
          <thead>
            <tr>
              <th rowSpan="2">Policy</th>
              {years.map((year) => (
                <th key={year} colSpan="2" className="year-header">
                  {year}-{(year + 1).toString().slice(-2)}
                </th>
              ))}
            </tr>
            <tr>
              {years.map((year) => (
                <React.Fragment key={year}>
                  <th className="source-header pe">PE</th>
                  <th className="source-header obr">OBR</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {policies.map(([policyId, policy]) => (
              <tr key={policyId}>
                <td className="policy-name-cell">{policy.name}</td>
                {years.map((year) => {
                  const yearData = policy.years[year] || {};
                  const pe = yearData.policyengine;
                  const obr = getObrValue(yearData);
                  return (
                    <React.Fragment key={year}>
                      <td
                        className={`value-cell pe ${getDifferenceClass(pe, obr)}`}
                      >
                        {formatValue(pe)}
                      </td>
                      <td className="value-cell obr">
                        {formatValue(obr)}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="comparison-legend" hidden={!showTable}>
        Difference from OBR:{" "}
        <span className="legend-item">
          <span className="legend-dot diff-small" aria-hidden="true"></span>
          under £0.5bn
        </span>{" "}
        <span className="legend-item">
          <span className="legend-dot diff-medium" aria-hidden="true"></span>
          £0.5–2bn
        </span>{" "}
        <span className="legend-item">
          <span className="legend-dot diff-large" aria-hidden="true"></span>
          over £2bn
        </span>
      </p>
    </div>
  );
}

export default OBRComparisonTable;

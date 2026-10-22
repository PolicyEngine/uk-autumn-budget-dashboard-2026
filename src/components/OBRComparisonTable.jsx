import React, { useState, useEffect } from "react";
import "./OBRComparisonTable.css";
import { DISPLAY_YEARS } from "../utils/displayYears";

function OBRComparisonTable({ selectedPolicies }) {
  const [comparisonData, setComparisonData] = useState(null);
  const [showBehavioural, setShowBehavioural] = useState(true);

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
        const yearIdx = peHeaders.indexOf("year");
        const valueIdx = peHeaders.indexOf("value");

        for (let i = 1; i < peLines.length; i++) {
          const values = peLines[i].split(",");
          const reform_id = values[reformIdIdx];
          const year = parseInt(values[yearIdx]);
          const pe_value = parseFloat(values[valueIdx]);
          const key = `${reform_id}_${year}`;

          if (obrData[key]) {
            obrData[key].policyengine_value = pe_value;
          }
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
      <p className="comparison-description">
        PolicyEngine's static estimates against the OBR's costings from the
        November 2025{" "}
        <a
          href="https://obr.uk/efo/economic-and-fiscal-outlook-november-2025/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Economic and Fiscal Outlook
        </a>
        , in £ billion a year. Positive values raise revenue or reduce
        spending; negative values do the opposite.
      </p>

      {hasBothTypes && (
        <div className="obr-toggle-container">
          <span className="toggle-label" id="obr-basis-label">
            OBR basis
          </span>
          <div className="toggle-buttons" role="group" aria-labelledby="obr-basis-label">
            <button
              type="button"
              aria-pressed={!showBehavioural}
              className={`toggle-btn ${!showBehavioural ? "active" : ""}`}
              onClick={() => setShowBehavioural(false)}
            >
              Static
            </button>
            <button
              type="button"
              aria-pressed={showBehavioural}
              className={`toggle-btn ${showBehavioural ? "active" : ""}`}
              onClick={() => setShowBehavioural(true)}
            >
              Post-behavioural
            </button>
          </div>
        </div>
      )}

      <div className="comparison-table-wrapper">
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

      <p className="comparison-legend">
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

      <p className="comparison-note">
        PolicyEngine estimates are static: they leave out behavioural
        responses, which the OBR's post-behavioural costings include.
      </p>
    </div>
  );
}

export default OBRComparisonTable;

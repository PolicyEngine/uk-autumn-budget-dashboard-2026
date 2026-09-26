import React, { useState, useEffect } from "react";
import "./OBRComparisonTable.css";

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
          obr_static: staticIdx >= 0 && values[staticIdx] ? parseFloat(values[staticIdx]) : null,
          obr_behavioural:
              behaviouralIdx >= 0 && values[behaviouralIdx] ? parseFloat(values[behaviouralIdx]) : null,
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

  if (!filteredData.some((row) => row.obr_static !== null || row.obr_behavioural !== null)) {
    return <p className="comparison-description">No like-for-like official OBR costing is available for the selected policies.</p>;
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

  const years = [2026, 2027, 2028, 2029, 2030];
  const policies = Object.entries(policiesMap);

  const formatValue = (value) => {
    if (value === null || value === undefined || isNaN(value)) return "—";
    const sign = value >= 0 ? "" : "-";
    return `${sign}£${Math.abs(value).toFixed(1)}bn`;
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
      <h2>PolicyEngine vs OBR comparison</h2>
      <p className="comparison-description">
        This table shows PolicyEngine model-year estimates alongside available
        official OBR costings. Annual income tax uses the UK tax year starting
        in the labelled year; fuel and bus impacts use the calendar year.
        These windows differ from OBR fiscal-year costings. Values are in
        billions of pounds; an em dash means no comparable OBR estimate.
        Positive values indicate revenue for the Government; negative values
        indicate costs.
      </p>

      {hasBothTypes && (
        <div className="obr-toggle-container">
          <span className="toggle-label">
            Compare PolicyEngine (static) with OBR:
          </span>
          <div className="toggle-buttons">
            <button
              className={`toggle-btn ${!showBehavioural ? "active" : ""}`}
              onClick={() => setShowBehavioural(false)}
            >
              Static
            </button>
            <button
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
                  {year} model year
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
                      <td
                        className={`value-cell obr ${getDifferenceClass(pe, obr)}`}
                      >
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

      <div className="comparison-legend">
        <span className="legend-item">
          <span className="legend-dot diff-small"></span>
          Difference &lt; £0.5bn
        </span>
        <span className="legend-item">
          <span className="legend-dot diff-medium"></span>
          Difference £0.5-2bn
        </span>
        <span className="legend-item">
          <span className="legend-dot diff-large"></span>
          Difference &gt; £2bn
        </span>
      </div>

      <p className="comparison-note">
        <strong>Note:</strong> PolicyEngine scenarios can include their own
        behavioural assumptions, including the CGT realisations response.
        The OBR publishes separately modelled static and post-behavioural
        costings. Historical official entries shown here come from the
        November 2025 forecast.{" "}
        {showBehavioural
          ? "Post-behavioural costings include effects like tax avoidance, reduced consumption, and price pass-through."
          : "Static costings assume no change in taxpayer behaviour."}{" "}
        A comparison requires a like-for-like published OBR costing for each
        policy and period; matching year labels alone are insufficient.
      </p>
    </div>
  );
}

export default OBRComparisonTable;

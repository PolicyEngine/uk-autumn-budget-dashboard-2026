import React, { useState, useEffect } from "react";
import "./OBRComparisonTable.css";
import "./ViewSwitch.css";
import PillSelect from "./PillSelect";
import { DISPLAY_YEARS, DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import UnavailableNotice from "./publication/UnavailableNotice";
import OBRDumbbellChart from "./OBRDumbbellChart";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";
import { loadVerifiedFlatCsv } from "../utils/publication/flat";

/** What the comparison says while the OBR has not costed the selected measures. */
export const OBR_UNAVAILABLE =
  "Shown once the OBR publishes its costings for these measures.";

function OBRComparisonTable({ selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const catalogue = useMeasureCatalogue();
  const { byId } = catalogue;
  const [comparisonData, setComparisonData] = useState(null);
  const [loadFailure, setLoadFailure] = useState(null);
  // Static by default: like for like with PolicyEngine's static estimates
  const [showBehavioural, setShowBehavioural] = useState(false);
  // The comparison shows as a chart or as a table, never both
  const [view, setView] = useState("chart");
  const showTable = view === "table";

  useEffect(() => {
    let live = true;
    loadVerifiedFlatCsv("obr_comparison.csv", catalogue)
      .then((obrCsvText) => {
        const obrData = Object.create(null);
        const numeric = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
        for (const row of parseDashboardCsv(obrCsvText)) {
          const key = `${row.reform_id}_${row.year}`;
          obrData[key] = {
            reform_id: row.reform_id,
            reform_name: row.reform_name,
            year: Number(row.year),
            obr_static: numeric(row.obr_static_value),
            obr_behavioural: numeric(row.obr_post_behavioural_value),
          };
        }
        for (const row of Object.values(catalogue.tablesByKey ?? {}).flatMap((tables) => tables.budgetary_impact ?? [])) {
          const key = `${row.reform_id}_${row.year}`;
          if (!obrData[key]) obrData[key] = {
            reform_id: row.reform_id,
            reform_name: row.reform_name,
            year: Number(row.year),
            obr_static: null,
            obr_behavioural: null,
          };
          obrData[key].policyengine_value = numeric(row.value);
        }

        // Convert to array
        const data = Object.values(obrData);
        if (live) setComparisonData({ catalogue, rows: data });
      })
      .catch(() => { if (live) setLoadFailure(catalogue); });
    return () => { live = false; };
  }, [catalogue]);

  if (selectedPolicies.length === 0) return null;
  // Today no OBR file can be bound (it holds the November 2025 costings; see
  // FLAT_VIEW_FILES in utils/publication/flat.js), so this is what shows
  if (loadFailure === catalogue) return <UnavailableNotice reason="The OBR comparison is unavailable: no OBR costings for this Budget are bound to the approved results." />;
  if (comparisonData?.catalogue !== catalogue) return null;

  // Filter to selected policies
  const filteredData = comparisonData.rows.filter((row) =>
    selectedPolicies.includes(row.reform_id) && isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
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
  const policiesMap = Object.create(null);
  filteredData.forEach((row) => {
    if (!policiesMap[row.reform_id]) {
      policiesMap[row.reform_id] = {
        name: byId.get(row.reform_id)?.name ?? row.reform_name,
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
  const policies = catalogue.measures
    .filter((measure) => policiesMap[measure.id])
    .map((measure) => [measure.id, policiesMap[measure.id]]);

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

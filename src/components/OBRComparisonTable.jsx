import React, { useState, useEffect } from "react";
import "./OBRComparisonTable.css";
import PillSelect from "./PillSelect";
import { DISPLAY_YEARS, DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import UnavailableNotice from "./publication/UnavailableNotice";
import OBRDumbbellChart from "./OBRDumbbellChart";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";
import { loadVerifiedFlatCsv } from "../utils/publication/flat";
import Disclosure from "./Disclosure";
import SourceLink from "./SourceLink";

/** What the comparison says while the OBR has not costed the selected measures. */
export const OBR_UNAVAILABLE = "The OBR has not costed the selected measures.";

/**
 * The OBR's and PolicyEngine's figures by measure and year, for displayable
 * measures only: the OBR's from obr_comparison.csv once it verifies against
 * the approved results, PolicyEngine's from the catalogue's verified
 * budgetary tables. Null while loading. `{ unavailable: true }` when no OBR
 * file can be bound: today it holds the November 2025 costings (see
 * FLAT_VIEW_FILES in utils/publication/flat.js).
 */
export function useObrComparisonData(enabled = true) {
  const catalogue = useMeasureCatalogue();
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
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
        if (live) setLoaded({
          catalogue,
          rows: data.filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year)),
        });
      })
      .catch(() => { if (live) setLoaded({ catalogue, unavailable: true }); });
    return () => { live = false; };
  }, [enabled, catalogue]);
  // Nothing loaded for an earlier catalogue is shown
  return loaded?.catalogue === catalogue ? loaded : null;
}

/** Whether the OBR has a figure for any of the selected measures. */
export function hasObrFigures(rows, selectedPolicies) {
  return (rows ?? []).some(
    (row) =>
      selectedPolicies.includes(row.reform_id) &&
      (Number.isFinite(row.obr_static) || Number.isFinite(row.obr_behavioural)),
  );
}

function OBRComparisonTable({ selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR, data }) {
  const catalogue = useMeasureCatalogue();
  const { byId } = catalogue;
  const fetched = useObrComparisonData(!data);
  const comparisonData = data ?? fetched;
  // Static by default: like for like with PolicyEngine's static estimates
  const [showBehavioural, setShowBehavioural] = useState(false);
  // The comparison shows as a chart or as a table, never both
  const [view, setView] = useState("chart");
  const showTable = view === "table";

  if (selectedPolicies.length === 0) return null;
  // Today no OBR file can be bound, so this is what shows
  if (comparisonData?.unavailable) return <UnavailableNotice reason="The OBR comparison is unavailable: no OBR costings for this Budget are bound to the approved results." />;
  if (!comparisonData) return null;

  // Filter to selected policies
  const filteredData = comparisonData.rows.filter((row) => selectedPolicies.includes(row.reform_id));

  if (filteredData.length === 0) return null;

  // The OBR's costings are joined by measure id. Until it costs these
  // measures (with the Budget on 28 October), none has an OBR figure, so
  // nothing is paired: the comparison says when it will be available.
  const hasFigures = hasObrFigures(filteredData, selectedPolicies);
  if (!hasFigures) {
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
          PolicyEngine's static estimates against{" "}
          <SourceLink source="obr_budget_2026_costings" />, £bn a year; positive values raise revenue.
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
        <PillSelect
          variant="light"
          name="Show as"
          prefix="Show"
          value={showTable ? "table" : "chart"}
          onChange={setView}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
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
                  <th className="source-header pe">PolicyEngine (static)</th>
                  <th className="source-header obr">OBR ({showBehavioural ? "post-behavioural" : "static"})</th>
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

/**
 * The OBR comparison at the foot of the Public finances card: an expander
 * once the OBR has costed any selected measure, and until then one muted
 * line saying when it will be (an expander that opens to "not yet" reads
 * as broken).
 */
export function ObrComparisonFoot({ selectedPolicies, selectedYear }) {
  const data = useObrComparisonData();
  if (!data || selectedPolicies.length === 0) return null;
  // No verified OBR figures for the selection: nothing at all
  if (data.unavailable || !hasObrFigures(data.rows, selectedPolicies)) return null;
  return (
    <Disclosure id="obr-comparison" inCard title="Compare with OBR estimates" contentClassName="obr-content">
      <OBRComparisonTable selectedPolicies={selectedPolicies} selectedYear={selectedYear} data={data} />
    </Disclosure>
  );
}

import { useId, useState } from "react";
import OutcomeToggle from "./OutcomeToggle";
import UnavailableNotice from "./publication/UnavailableNotice";
import { useGeographyData } from "../hooks/useGeographyData";
import { downloadFile } from "../utils/downloadFile";
import {
  EXPORT_UNITS,
  buildCsv,
  buildTxt,
  formatGenerated,
  regionExportRows,
} from "../utils/geography/exportTable";
import {
  DIRECTION_SHORT_LABELS,
  OUTCOME_DESCRIPTIONS,
  SUPPORT_BAND_SHORT_LABELS,
  TIER_LABELS,
  formatFigure,
  formatInterval,
} from "../utils/geography/format";
import { REGIONS } from "../utils/geography/regions";
import {
  choiceLabel,
  choiceMeasureNames,
  chooseReform,
} from "../utils/geography/selection";
import { REGION_VIEW_ID, viewState } from "../utils/geography/view";
import { fiscalYearLabel } from "../utils/publication/format";
import { CHART_LOGO } from "../utils/chartLogo";
import ChartDownloadMenu from "./ChartDownloadMenu";
import "./RegionView.css";

const TITLE = "Results by region";

function RegionRow({ region, row }) {
  let cells;
  if (!row) {
    cells = [
      <td key="value" className="region-cell-muted">
        No data
      </td>,
      <td key="interval" />,
    ];
  } else if (row.tier === "withheld") {
    cells = [
      <td key="value" className="region-cell-muted">
        Not published
      </td>,
      <td key="interval" />,
    ];
  } else {
    cells = [
      <td key="value" className="region-cell-value">
        {formatFigure(row.outcome, row.value)}
      </td>,
      <td key="interval">{formatInterval(row.outcome, row.lo, row.hi)}</td>,
    ];
  }
  const published = row && row.tier !== "withheld";
  return (
    <tr className={row ? `region-row-${row.tier}` : "region-row-missing"}>
      <th scope="row">{region.name}</th>
      {cells}
      <td>{published ? DIRECTION_SHORT_LABELS[row.direction] : ""}</td>
      <td>{published ? SUPPORT_BAND_SHORT_LABELS[row.supportBand] : ""}</td>
      <td className={row ? `region-tier region-tier-${row.tier}` : ""}>
        {row ? TIER_LABELS[row.tier] : ""}
      </td>
    </tr>
  );
}

/**
 * Results by region for the selected measure and year: one row per region
 * or nation, with the published value, its 90% interval, its direction,
 * support band and tier. Withheld figures say "Not
 * published"; a region with no row says "No data". Nothing is summed.
 */
function RegionView({ selectedPolicies = [], selectedYear = 2029, policies = [] }) {
  const regional = useGeographyData("regional");
  const [outcome, setOutcome] = useState("relative_change");
  const titleId = useId();
  const captionId = useId();

  const choice = chooseReform({
    selectedIds: selectedPolicies,
    policyIds: policies.map((policy) => policy.id),
    reforms: regional.table?.reforms ?? [],
  });
  const view = viewState({
    data: regional,
    choice,
    year: selectedYear,
    outcome,
    place: "by region",
  });
  const label = choiceLabel(choice, policies);
  const yearLabel = fiscalYearLabel(selectedYear);
  const rows = view.kind === "rows" ? view.rows : null;

  const exportFile = (kind) => {
    if (!rows) return;
    const exported = regionExportRows(regional.table, {
      reform: view.reform,
      year: selectedYear,
    });
    const names = choiceMeasureNames(choice, policies);
    const measures =
      choice.kind === "package" ? `${label}: ${names.join("; ")}` : label;
    const metadata = [
      ["Generated", formatGenerated(new Date())],
      [choice.kind === "package" ? "Measures" : "Measure", measures],
      ["Reform", view.reform],
      ["Year", yearLabel],
      ["Units", EXPORT_UNITS],
      ["Source", "PolicyEngine UK Autumn Budget 2026 dashboard"],
    ];
    const filename = `results-by-region-${view.reform}-${selectedYear}`;
    if (kind === "csv") {
      downloadFile(
        buildCsv(exported, metadata),
        `${filename}.csv`,
        "text/csv;charset=utf-8",
      );
    } else {
      downloadFile(
        buildTxt(exported, {
          title: `${TITLE}: UK Autumn Budget 2026 dashboard`,
          metadata,
        }),
        `${filename}.txt`,
        "text/plain;charset=utf-8",
      );
    }
  };

  return (
    <div
      className="region-view"
      id={REGION_VIEW_ID}
      role="region"
      aria-labelledby={titleId}
    >
      <div className="chart-header">
        <div>
          <h2 id={titleId}>
            {TITLE}, <span className="nowrap">{yearLabel}</span>
          </h2>
          <p className="chart-description">
            The average change in household net income in each region and
            nation, with its 90% interval. Figures are rounded to the precision
            the data supports, and some are not published, to protect survey
            respondents' confidentiality.
          </p>
        </div>
        {rows && (
          <ChartDownloadMenu
            ariaLabel="Download results by region"
            formats={{
              csv: () => exportFile("csv"),
              txt: () => exportFile("txt"),
            }}
          />
        )}
      </div>

      {(label || rows) && (
        <div className="region-toolbar">
          {label && (
            <p className="region-showing">
              <span className="region-showing-label">Showing</span>{" "}
              <span className="region-showing-name">{label}</span>
            </p>
          )}
          {rows && <OutcomeToggle value={outcome} onChange={setOutcome} />}
        </div>
      )}

      {view.kind === "loading" && (
        <p className="geography-loading">Loading results by region…</p>
      )}

      {view.kind === "notice" && (
        <UnavailableNotice reason={view.reason}>
          {view.detail && <p>{view.detail}</p>}
        </UnavailableNotice>
      )}

      {rows && (
        <>
          {/* The table's caption, outside the part that scrolls, so it
              wraps to the card on a narrow screen. */}
          <p id={captionId} className="region-table-caption">
            {OUTCOME_DESCRIPTIONS[outcome]}: {label}, {yearLabel}
          </p>
          {/* On a narrow screen the table scrolls sideways inside the
              card; the wrapper takes focus so a keyboard can scroll it. */}
          <div
            className="region-table-scroll"
            role="region"
            aria-label="Table of results by region"
            tabIndex={0}
          >
            <table className="region-table" aria-labelledby={captionId}>
              <thead>
                <tr>
                  <th scope="col">Region</th>
                  <th scope="col">Change</th>
                  <th scope="col">90% interval</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Survey households</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {REGIONS.map((region) => (
                  <RegionRow
                    key={region.code}
                    region={region}
                    row={rows.find((row) => row.areaCode === region.code) ?? null}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="region-note">
            Approximate figures rest on few survey households, and their
            intervals understate the uncertainty. Figures marked not
            published are withheld to protect survey respondents'
            confidentiality.
          </p>
          <div className="card-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CHART_LOGO.href} alt="PolicyEngine" />
          </div>
        </>
      )}
    </div>
  );
}

export default RegionView;

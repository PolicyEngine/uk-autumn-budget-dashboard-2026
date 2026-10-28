import { useState, useEffect, useRef } from "react";
import SwapTransition from "./SwapTransition";
import "./OBRComparisonTable.css";
import ControlBar from "./ControlBar";
import ViewToggle from "./ViewToggle";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartMoreInfo from "./ChartMoreInfo";
import TitleIcon from "./TitleIcon";
import MeasureRowLabel from "./MeasureRowLabel";
import NoBreakYear from "./NoBreakYear";
import Tip from "./Tip";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import UnavailableNotice from "./publication/UnavailableNotice";
import OBRDumbbellChart, { dumbbellLegendItems, formatBn, formatBn as formatFigure, formatDifference, obrValue, rowDecimals, shownDifference } from "./OBRDumbbellChart";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv, fiscalYear } from "../utils/chartCsv";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { shortNameOf } from "../utils/policyDetails";
import { loadPolicyParameters, measureWindows, outOfForceText } from "../utils/policyParameters";
import { loadOfficialCostings, OfficialCostingsPendingError } from "../utils/publication/officialCostings";
import { SOURCES } from "../utils/sources";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { OBR_COMPARISON_BASES, OBR_DEVIATION_NOTES, OBR_DEVIATION_STATEMENT, comparisonBasisFor, deviationNoteFor } from "../utils/obrDeviationNotes";

/** What the comparison says when the official costings cover none of the selected measures. */
export const OBR_UNAVAILABLE = "The official costings have no figures for the selected policies.";

/**
 * What the comparison's card says while the official costings file is not
 * published here, or does not check against these results (Vahid, 27
 * October: the card is always on Public finances). The Treasury published
 * the costings with the Budget; the file follows once checked.
 */
export const OBR_PENDING = "The official costings were published with the Budget; this comparison fills in once we have checked them against our estimates.";

/** The card's title without a year, while there are no figures to date. */
export const OBR_CARD_TITLE = "How our estimates compare with the official costings";

/** Within this many £bn, an estimate counts as close to the official costing in the card's sentence. */
export const CLOSE_BN = 0.2;

const isValue = (value) => typeof value === "number" && Number.isFinite(value);

/** Each measure's scored years (policy_parameters.json), once loaded; {} until then or without the file. */
function useMeasureWindows() {
  const [windows, setWindows] = useState({});
  useEffect(() => {
    let live = true;
    loadPolicyParameters().then((document) => {
      if (live) setWindows(measureWindows(document));
    });
    return () => {
      live = false;
    };
  }, []);
  return windows;
}

/**
 * The official costings' and PolicyEngine's figures by measure and year, for
 * displayable measures only: the official ones from official_costings.json
 * (HM Treasury's costings, certified by the OBR, as the reconciliation gate
 * compares them) once it names this manifest's Budget and only its measures
 * (utils/publication/officialCostings.js), PolicyEngine's from the
 * catalogue's verified budgetary tables. Null while loading;
 * `{ pending: true }` while the file is not published; `{ unavailable: true }`
 * when it is published but does not check. obr_comparison.csv is never read:
 * it holds last year's costings under reused ids.
 */
export function useObrComparisonData(enabled = true) {
  const catalogue = useMeasureCatalogue();
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    loadOfficialCostings(catalogue)
      .then((officialRows) => {
        const obrData = Object.create(null);
        const numeric = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
        for (const row of officialRows) {
          obrData[`${row.reform_id}_${row.year}`] = { ...row, reform_name: catalogue.byId?.get(row.reform_id)?.name ?? row.reform_id };
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
        const data = Object.values(obrData);
        if (live) setLoaded({
          catalogue,
          rows: data.filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year)),
        });
      })
      .catch((error) => {
        if (live) setLoaded(error instanceof OfficialCostingsPendingError ? { catalogue, pending: true } : { catalogue, unavailable: true });
      });
    return () => { live = false; };
  }, [enabled, catalogue]);
  // Nothing loaded for an earlier catalogue is shown
  return loaded?.catalogue === catalogue ? loaded : null;
}

/** Whether the official costings have a figure for any of the selected measures. */
export function hasObrFigures(rows, selectedPolicies) {
  return (rows ?? []).some(
    (row) =>
      selectedPolicies.includes(row.reform_id) &&
      (Number.isFinite(row.obr_static) || Number.isFinite(row.obr_behavioural)),
  );
}

/**
 * One row per selected measure for a year, largest official costing first
 * (by size, either sign), measures with no official figure last:
 * { id, name, pe, obr, obrStatic, obrBehavioural, notComparable, status },
 * null for a missing figure; `notComparable` is the reviewer's reason where
 * the official costing for the year is not comparable with ours. `name` is
 * the measure's short name, as elsewhere on the page. `status` ("Starts
 * 2030-31", "Ended 2029-30", "2026-27 only") is set where the measure is
 * not in force that year (its scored years in `windows`, from
 * policy_parameters.json: measureWindows) and neither side has an effect,
 * so the row says why in place of "£0, same"; a measure in force with a
 * genuine zero keeps its £0.
 */
export function comparisonRows(sourceRows, selectedPolicies, year, showBehavioural, catalogue, windows = {}) {
  const byMeasure = new Map();
  for (const row of sourceRows) {
    if (!selectedPolicies.includes(row.reform_id) || Number(row.year) !== Number(year)) continue;
    byMeasure.set(row.reform_id, row);
  }
  // Catalogue order first, so ties keep the page's usual order
  const ids = (catalogue.measures ?? []).map((measure) => measure.id).filter((id) => byMeasure.has(id));
  const rows = ids.map((id) => {
    const row = byMeasure.get(id);
    const yearData = { obr_static: row.obr_static, obr_behavioural: row.obr_behavioural };
    return {
      id,
      name: shortNameOf(catalogue.byId?.get(id) ?? { id, name: row.reform_name }),
      // The catalogue's measure, for its row label (icon, colour, category)
      measure: catalogue.byId?.get(id) ?? { id, name: row.reform_name },
      pe: isValue(row.policyengine_value) ? row.policyengine_value : null,
      obr: obrValue(yearData, showBehavioural),
      obrStatic: isValue(row.obr_static) ? row.obr_static : null,
      obrBehavioural: isValue(row.obr_behavioural) ? row.obr_behavioural : null,
      notComparable: typeof row.not_comparable === "string" ? row.not_comparable : null,
    };
  }).map((row) => {
    const none = (value) => value === null || value === 0;
    const quiet = none(row.pe) && none(row.obrStatic) && none(row.obrBehavioural);
    return { ...row, status: quiet ? outOfForceText(windows[row.id], Number(year), fiscalYear) : null };
  });
  const size = (row) => (row.obr === null ? -1 : Math.abs(row.obr));
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => size(b.row) - size(a.row) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The card's one sentence, from the rows: how many of the paired measures
 * PolicyEngine puts within £0.2bn of the official costing, and where the
 * two are furthest apart. Descriptive only. Null with nothing paired.
 */
// A word joiner after the minus, so "−£6.5bn" never wraps after its sign
const keep = (text) => text.replace("−", "−\u2060");

export function comparisonSentence(rows, obrKind) {
  const formatBn = (value) => keep(formatFigure(value));
  const paired = rows.filter((row) => row.pe !== null && row.obr !== null);
  if (paired.length === 0) return null;
  const costing = `the official ${obrKind} costing`;
  if (paired.length === 1) {
    const [row] = paired;
    return `For ${row.name}, our static estimate is ${formatBn(row.pe)} and ${costing} is ${formatBn(row.obr)}.`;
  }
  // On the figures as shown, so the sentence agrees with the labels
  const gap = (row) => Math.abs(shownDifference(row.pe, row.obr));
  const close = paired.filter((row) => gap(row) <= CLOSE_BN + 1e-9).length;
  const largest = paired.reduce((best, row) => (gap(row) > gap(best) ? row : best));
  const lead = close === paired.length
    ? `For all ${paired.length} policies our static estimate is within ${formatBn(CLOSE_BN)} of ${costing}`
    : `For ${close} of ${paired.length} policies our static estimate is within ${formatBn(CLOSE_BN)} of ${costing}`;
  if (formatBn(largest.pe) === formatBn(largest.obr)) return `${lead}.`;
  return `${lead}; the largest gap is ${largest.name} (${formatBn(largest.pe)} vs ${formatBn(largest.obr)}).`;
}

// About this chart: what the two bases are, why the figures differ, sources
const COMPARISON_INFO = {
  shows:
    "PolicyEngine's estimate of each policy's effect on the public finances beside the official costing for the same year, in £ billion; positive values raise revenue or cut spending. Largest official costing first.",
  how: [
    "PolicyEngine's figures are static, so an official static costing is the like-for-like comparison. Budget 2026's costings give one figure per policy, which for most policies includes behavioural responses, so the card compares with that.",
    "On the % scale each official costing is 100%; a policy costed under £50m has no %.",
    "Difference is PolicyEngine minus the official figure.",
  ],
  definitions: [
    { term: "Static costing", meaning: "The direct effect, with behaviour held fixed." },
    { term: "Post-behavioural costing", meaning: "The static costing plus expected responses, such as changes in hours worked or spending." },
  ],
  caveats: [
    "Effects outside households, or on incomes the survey covers thinly (such as the very top), are estimated less fully than in official costings built from administrative data.",
    "The two can also differ in the economic forecast, take-up and the parts of a policy each models.",
    "Our figures are by tax year. The official costings are on a National Accounts basis, in which tax paid through Self Assessment can fall in a later year: a change in it, such as the trading allowance, can appear about a year later in them than in ours.",
  ],
  sources: [
    { label: "PolicyEngine UK microsimulation" },
    { label: SOURCES.obr_budget_2026_costings.label.replace(/^the /, "The "), href: SOURCES.obr_budget_2026_costings.url },
  ],
  method: { anchor: METHOD_ANCHORS.publicFinances, label: "How we cost the policies" },
};

/** A Difference cell's tip: what each side counts, then why they differ. */
function DeviationTip({ basis, note }) {
  return (
    <>
      {basis && <span className="obr-basis-line">{basis}</span>}
      {basis && note && " "}
      {note}
    </>
  );
}

/**
 * How our estimates compare with the official costings: a card of its own
 * on Public finances, directly under Revenue impact, for the year in the
 * header. A dumbbell chart (or a table) per measure, largest official
 * costing first, the difference in £bn at the right. Its Options choose
 * the official basis and the chart's scale. Under it, why the two differ:
 * the general statement, then each policy's note (`notes`, by measure id:
 * utils/obrDeviationNotes.js), which also shows in its row's tooltip and,
 * in the table, on its Difference cell. Above each note, wherever it
 * shows, is the line saying what each side counts (`bases`).
 */
function OBRComparisonTable({ selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR, data, notes = OBR_DEVIATION_NOTES, bases = OBR_COMPARISON_BASES }) {
  const catalogue = useMeasureCatalogue();
  const windows = useMeasureWindows();
  const fetched = useObrComparisonData(!data);
  const comparisonData = data ?? fetched;
  // Static by default: like for like with PolicyEngine's static estimates
  const [showBehavioural, setShowBehavioural] = useState(false);
  const [view, setView] = useState("chart");
  const [scale, setScale] = useState("bn");
  const chartRef = useRef(null);
  const tableRef = useRef(null);
  const showTable = view === "table";

  if (selectedPolicies.length === 0) return null;
  // Nothing until the official costings are published (the page's card,
  // ObrComparisonCard, says when they are)
  if (comparisonData?.pending) return null;
  if (comparisonData?.unavailable) return <UnavailableNotice reason="The comparison with the official costings is unavailable: the costings file does not match these results." />;
  if (!comparisonData) return null;

  const selectedRows = comparisonData.rows.filter((row) => selectedPolicies.includes(row.reform_id));
  if (selectedRows.length === 0) return null;
  if (!hasObrFigures(selectedRows, selectedPolicies)) {
    return (
      <div className="obr-comparison-section">
        <p className="comparison-description obr-unavailable">{OBR_UNAVAILABLE}</p>
      </div>
    );
  }

  const yearLabel = fiscalYear(selectedYear);
  // Each row with what each side counts and why it differs from the
  // official costing, while they were written for the measure as published
  const rows = comparisonRows(selectedRows, selectedPolicies, selectedYear, showBehavioural, catalogue, windows).map((row) => ({
    ...row,
    basis: comparisonBasisFor(row.measure, bases),
    note: deviationNoteFor(row.measure, notes),
  }));
  const notedRows = rows.filter((row) => row.basis !== null || row.note !== null);
  // The basis the figures shown are on: the other one when the official
  // costings give none on the chosen basis this year (Budget 2026 publishes
  // one Exchequer impact per measure, post-behavioural), so no line calls
  // a post-behavioural figure static
  const onBasis = (behavioural) => rows.some((row) => (behavioural ? row.obrBehavioural : row.obrStatic) !== null);
  const shownBehavioural = !onBasis(showBehavioural) && onBasis(!showBehavioural) ? !showBehavioural : showBehavioural;
  const obrKind = shownBehavioural ? "post-behavioural" : "static";
  const hasBothTypes = selectedRows.some((row) => row.obr_static !== null && row.obr_behavioural !== null);
  // The last year the official costings cover, for a year past it
  const officialYears = selectedRows
    .filter((row) => isValue(row.obr_static) || isValue(row.obr_behavioural))
    .map((row) => Number(row.year));
  const yearCovered = rows.some((row) => row.obr !== null);
  const lastOfficial = officialYears.length ? Math.max(...officialYears) : null;
  // A year a reviewer classified not comparable: said so, with the reason,
  // never as a gap in the official costings
  const notComparableRows = rows.filter((row) => row.notComparable !== null);
  const notComparableNote = (row) => `${row.name}: the official costing for ${yearLabel} is not comparable with our estimate. ${row.notComparable}`;
  const notCovered = notComparableRows.length > 0 && notComparableRows.length === rows.length
    ? notComparableRows.map(notComparableNote).join(" ")
    : `${yearLabel} is not in the official costings${lastOfficial !== null && lastOfficial < selectedYear ? `, which run to ${fiscalYear(lastOfficial)}` : ""}.`;

  const title = `How our estimates compare with the official costings, ${yearLabel}`;
  const sentence = yearCovered ? comparisonSentence(rows, obrKind) : notCovered;

  // One CSV for both views: the table's columns
  const csv = () =>
    buildChartCsv({
      title,
      units: "£ billion a year; positive values raise revenue or reduce spending",
      source: `PolicyEngine UK microsimulation; official figures from ${SOURCES.obr_budget_2026_costings.label}`,
      columns: [
        { key: "name", label: "Policy" },
        { key: "pe", label: "PolicyEngine, static (£bn)", decimals: 4 },
        { key: "obrStatic", label: "Official, static (£bn)", decimals: 4 },
        { key: "obrBehavioural", label: "Official, post-behavioural (£bn)", decimals: 4 },
        { key: "difference", label: `Difference, PolicyEngine minus official ${obrKind} (£bn)`, decimals: 4 },
        { key: "basis", label: "What each side counts" },
        { key: "note", label: "Why it differs" },
      ],
      rows: rows.map((row) => ({
        name: row.name,
        pe: row.pe ?? undefined,
        obrStatic: row.obrStatic ?? undefined,
        obrBehavioural: row.obrBehavioural ?? undefined,
        difference: row.pe !== null && row.obr !== null ? row.pe - row.obr : undefined,
        basis: row.basis ?? undefined,
        note: row.note ?? undefined,
      })),
    });
  // The download follows the view: the chart's images, or the table's
  // (redrawn from the page, chartDownloads)
  const download = {
    chartRef: showTable ? tableRef : chartRef,
    name: `policyengine-official-costings-${selectedYear}`,
    csv,
    image: showTable || yearCovered,
    exportOptions: {
      title,
      description: `Each row shows a policy's budgetary impact in ${yearLabel}, in £ billion: PolicyEngine's static estimate and the official ${obrKind} costing, with the difference (PolicyEngine minus official) at the right. Positive values raise revenue or reduce spending.`,
      legendItems: dumbbellLegendItems(obrKind),
      logo: CHART_LOGO,
      svgSelector: showTable ? undefined : "svg",
      reservedLegendHeight: 0,
    },
  };

  const options = [
    hasBothTypes && {
      label: "Official basis",
      value: showBehavioural ? "post" : "static",
      onChange: (value) => setShowBehavioural(value === "post"),
      options: [
        { value: "static", label: "Static" },
        { value: "post", label: "Post-behavioural" },
      ],
    },
    !showTable && yearCovered && {
      label: "Scale",
      value: scale,
      onChange: setScale,
      options: [
        { value: "bn", label: "£bn" },
        { value: "pct", label: "% of official costing" },
      ],
    },
  ].filter(Boolean);

  // A row's figures at the chart's precision for that row (two decimals
  // where they round equal to £0.1bn but are apart). No figure: a muted
  // dash, said why in the note; a real zero (no effect that year): muted,
  // as the household table's zero change. Under £1bn a figure is in £m,
  // so one that is not zero never reads as nothing
  const shownZero = (text) => text === "£0";
  const cell = (value, decimals, kind, notComparable = null) => {
    if (notComparable !== null) {
      return <td className={`value-cell ${kind} is-none is-not-comparable`} title={notComparable}>Not comparable</td>;
    }
    if (!isValue(value)) return <td className={`value-cell ${kind} is-none`}>—</td>;
    const text = formatFigure(value, decimals);
    return <td className={`value-cell ${kind}${shownZero(text) ? " is-zero" : ""}`}>{text}</td>;
  };
  // What the note says under the table: the difference, then why a cell
  // has no figure, only where one is missing
  const officialMissing = rows.some((row) => row.notComparable === null && (row.obrStatic === null || row.obrBehavioural === null));
  const peMissing = rows.some((row) => row.pe === null);
  // A row with no figure on the chosen basis is differenced on the other
  const otherBasis = rows.some((row) => row.pe !== null && row.obr !== null && (shownBehavioural ? row.obrBehavioural === null : row.obrStatic === null));
  const tableNote = [
    `Difference: PolicyEngine minus the official ${obrKind} costing${otherBasis ? ` (the ${shownBehavioural ? "static" : "post-behavioural"} one where the official costings give only that)` : ""}.`,
    officialMissing && `— where the official costings give no figure on that basis for the policy in ${yearLabel}.`,
    peMissing && `— under PolicyEngine where we publish no estimate for ${yearLabel}.`,
    ...notComparableRows.map(notComparableNote),
  ].filter(Boolean);

  return (
    <div className="obr-comparison-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="scale" />
            <span className="title-text">
              <NoBreakYear text={title} />
            </span>
          </h3>
          <p className="chart-description">{sentence}</p>
        </div>
        <div className="chart-header-actions">
          <ViewToggle value={view} onChange={setView} name="the official costings comparison" />
          <ChartDownloadMenu download={download} chartTitle={title} />
        </div>
      </div>
      {options.length > 0 && (
        <div className="chart-controls ls-controls">
          <ControlBar name="The official costings comparison" options={options} />
        </div>
      )}

      {/* Chart or table: the new one fades in, the height eases */}
      <SwapTransition swapKey={`${view}-${yearCovered}`}>
        {!showTable && (yearCovered ? (
          <OBRDumbbellChart
            rows={rows}
            yearLabel={yearLabel}
            obrKind={obrKind}
            scale={scale}
            chartRef={chartRef}
            tooltipKey={`${selectedYear}-${showBehavioural}`}
          />
        ) : (
          <p className="obr-dumbbell-empty obr-not-covered">{notCovered}</p>
        ))}
        {showTable && (
          <div id="obr-comparison-table" className="comparison-table-wrapper">
            <table ref={tableRef} className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col" className="num">PolicyEngine</th>
                  <th scope="col" className="num">Official static</th>
                  <th scope="col" className="num">Official post-behavioural</th>
                  <th scope="col" className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  // The chart's precision (figures under £1bn are in £m)
                  const decimals = rowDecimals(row.pe, row.obr);
                  const difference = shownDifference(row.pe, row.obr, decimals);
                  if (row.status) {
                    // Not in force this year on either side: why, across the figures
                    return (
                      <tr key={row.id} className={`row-band${index % 2 === 0 ? " is-banded" : ""}`}>
                        <td className="policy-name-cell"><MeasureRowLabel measure={row.measure} name={row.name} /></td>
                        <td className="value-cell status-cell is-zero" colSpan={4}>{row.status}</td>
                      </tr>
                    );
                  }
                  return (
                    // Every second row on the faint band, as the chart's rows
                    <tr key={row.id} className={`row-band${index % 2 === 0 ? " is-banded" : ""}`}>
                      <td className="policy-name-cell"><MeasureRowLabel measure={row.measure} name={row.name} /></td>
                      {cell(row.pe, decimals, "pe")}
                      {cell(row.obrStatic, decimals, "obr", row.notComparable)}
                      {cell(row.obrBehavioural, decimals, "obr", row.notComparable)}
                      {/* No effect on either side: the zero difference muted too */}
                      <td
                        className={`value-cell difference${
                          difference === null
                            ? " is-none"
                            : shownZero(formatFigure(row.pe, decimals)) && shownZero(formatFigure(row.obr, decimals))
                              ? " is-zero"
                              : ""
                        }`}
                      >
                        {/* What each side counts and why it differs, on
                            hover, focus or a tap; the list under the table
                            says them too */}
                        {row.basis || row.note ? (
                          <Tip content={<DeviationTip basis={row.basis} note={row.note} />} wide>
                            <span className="difference-note-anchor" tabIndex={0}>
                              {formatDifference(difference, decimals)}
                            </span>
                          </Tip>
                        ) : (
                          formatDifference(difference, decimals)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tableNote.map((line) => (
              <p key={line} className="comparison-table-note">{line}</p>
            ))}
          </div>
        )}
      </SwapTransition>

      {/* Why the estimates differ, in view under the chart or table: the
          general reasons, then each policy's own, so every gap is
          explained on a phone too, where there is no hover */}
      <div className="obr-deviation">
        <p className="obr-deviation-statement">{OBR_DEVIATION_STATEMENT}</p>
        {notedRows.length > 0 && (
          <section className="obr-deviation-notes" aria-labelledby="obr-deviation-title">
            <h4 className="obr-deviation-title" id="obr-deviation-title">Why each policy differs</h4>
            <ul className="obr-deviation-list">
              {notedRows.map((row) => (
                // What each side counts on the name's line, the note
                // under it
                <li key={row.id} data-measure={row.id}>
                  <strong>{row.name}:</strong> {row.basis ?? row.note}
                  {row.basis && row.note && (
                    <>
                      {" "}
                      <span className="obr-deviation-note">{row.note}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="chart-footer">
        <ChartMoreInfo info={COMPARISON_INFO} />
      </div>
    </div>
  );
}

export default OBRComparisonTable;

/**
 * The comparison's card before the official costings can be shown: its
 * header and title, and one calm line. No figures, no options, no download.
 */
export function ObrComparisonEmpty() {
  return (
    <div className="obr-comparison-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="scale" />
            <span className="title-text">{OBR_CARD_TITLE}</span>
          </h3>
        </div>
      </div>
      <p className="obr-dumbbell-empty obr-pending-costings">{OBR_PENDING}</p>
    </div>
  );
}

/**
 * The comparison's card on Public finances, under Revenue impact. Until
 * a verified official costings file for this Budget is published (missing,
 * or one that does not check), the card says when it fills in; an
 * unverified or mismatched file is never shown. Once one is, the
 * comparison, when it costs any selected measure.
 */
export function ObrComparisonCard({ selectedPolicies, selectedYear }) {
  const data = useObrComparisonData();
  if (!data || selectedPolicies.length === 0) return null;
  if (data.pending || data.unavailable) {
    return (
      <section id="obr-comparison" className="report-section hero-chart">
        <ObrComparisonEmpty />
      </section>
    );
  }
  // A verified file with no official figure for the selection: nothing
  if (!hasObrFigures(data.rows, selectedPolicies)) return null;
  return (
    <section id="obr-comparison" className="report-section hero-chart">
      <OBRComparisonTable selectedPolicies={selectedPolicies} selectedYear={selectedYear} data={data} />
    </section>
  );
}

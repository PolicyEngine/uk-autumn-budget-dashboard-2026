import { useState, useEffect, useRef } from "react";
import SwapTransition from "./SwapTransition";
import "./OBRComparisonTable.css";
import ControlBar from "./ControlBar";
import ViewToggle from "./ViewToggle";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartMoreInfo from "./ChartMoreInfo";
import TitleIcon from "./TitleIcon";
import NoBreakYear from "./NoBreakYear";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import UnavailableNotice from "./publication/UnavailableNotice";
import OBRDumbbellChart, { dumbbellLegendItems, formatBn, formatDifference, obrValue } from "./OBRDumbbellChart";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv, fiscalYear } from "../utils/chartCsv";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { shortNameOf } from "../utils/policyDetails";
import { loadOfficialCostings, OfficialCostingsPendingError } from "../utils/publication/officialCostings";
import { SOURCES } from "../utils/sources";
import { METHOD_ANCHORS } from "./methodology/anchors";

/** What the comparison says when the official costings cover none of the selected measures. */
export const OBR_UNAVAILABLE = "The official costings have no figures for the selected measures.";

/** Within this many £bn, an estimate counts as close to the official costing in the card's sentence. */
export const CLOSE_BN = 0.2;

const isValue = (value) => typeof value === "number" && Number.isFinite(value);

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
 * { id, name, pe, obr, obrStatic, obrBehavioural }, null for a missing
 * figure. `name` is the measure's short name, as elsewhere on the page.
 */
export function comparisonRows(sourceRows, selectedPolicies, year, showBehavioural, catalogue) {
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
      pe: isValue(row.policyengine_value) ? row.policyengine_value : null,
      obr: obrValue(yearData, showBehavioural),
      obrStatic: isValue(row.obr_static) ? row.obr_static : null,
      obrBehavioural: isValue(row.obr_behavioural) ? row.obr_behavioural : null,
    };
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
export function comparisonSentence(rows, obrKind) {
  const paired = rows.filter((row) => row.pe !== null && row.obr !== null);
  if (paired.length === 0) return null;
  const costing = `the official ${obrKind} costing`;
  if (paired.length === 1) {
    const [row] = paired;
    return `For ${row.name}, our static estimate is ${formatBn(row.pe)} and ${costing} is ${formatBn(row.obr)}.`;
  }
  const gap = (row) => Math.abs(row.pe - row.obr);
  const close = paired.filter((row) => gap(row) <= CLOSE_BN + 1e-9).length;
  const largest = paired.reduce((best, row) => (gap(row) > gap(best) ? row : best));
  const lead = close === paired.length
    ? `For all ${paired.length} policies our static estimate is within £${CLOSE_BN}bn of ${costing}`
    : `For ${close} of ${paired.length} policies our static estimate is within £${CLOSE_BN}bn of ${costing}`;
  if (formatBn(largest.pe) === formatBn(largest.obr)) return `${lead}.`;
  return `${lead}; the largest gap is ${largest.name} (${formatBn(largest.pe)} vs ${formatBn(largest.obr)}).`;
}

// About this chart: what the two bases are, why the figures differ, sources
const COMPARISON_INFO = {
  shows:
    "Each row sets PolicyEngine's estimate of a measure's effect on the public finances beside the official costing for the same year, in £ billion; positive values raise revenue or reduce spending. Rows run from the largest official costing to the smallest, and the Difference column is PolicyEngine minus the official figure.",
  how: [
    "PolicyEngine's figures are static: they hold people's behaviour fixed, so the official static costing is the like-for-like comparison.",
    "With the scale set to % of official costing, every official costing sits at 100% and PolicyEngine's estimate is shown as a share of it, so small measures can be read beside large ones. A measure whose official costing is under £0.05bn has no % to show.",
  ],
  definitions: [
    { term: "Static costing", meaning: "The direct effect of a measure with behaviour held fixed: the same people, earnings and spending, under the new rules." },
    { term: "Post-behavioural costing", meaning: "The static costing adjusted for how people and firms are expected to respond, for example by changing hours worked, the timing of income or what they buy." },
  ],
  caveats: [
    "PolicyEngine simulates households from survey data. Effects that fall outside households, or on incomes the survey covers thinly (such as the very top), are estimated less fully than in an official costing built from administrative data.",
    "The two can also differ through the economic forecast each uses, the take-up of benefits and reliefs, and the parts of a measure each models.",
  ],
  sources: [
    { label: "PolicyEngine UK microsimulation" },
    { label: SOURCES.obr_budget_2026_costings.label.replace(/^the /, "The ") },
  ],
  method: { anchor: METHOD_ANCHORS.publicFinances, label: "How we cost the measures" },
};

/**
 * How our estimates compare with the official costings: a card of its own
 * on Public finances, directly under Revenue impact, for the year in the
 * header. A dumbbell chart (or a table) per measure, largest official
 * costing first, the difference in £bn at the right. Its Options choose
 * the official basis and the chart's scale.
 */
function OBRComparisonTable({ selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR, data }) {
  const catalogue = useMeasureCatalogue();
  const fetched = useObrComparisonData(!data);
  const comparisonData = data ?? fetched;
  // Static by default: like for like with PolicyEngine's static estimates
  const [showBehavioural, setShowBehavioural] = useState(false);
  const [view, setView] = useState("chart");
  const [scale, setScale] = useState("bn");
  const chartRef = useRef(null);
  const showTable = view === "table";

  if (selectedPolicies.length === 0) return null;
  // Nothing until the official costings are published (no pending line:
  // nothing on the page may stop being true on Budget day, c4717870)
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

  const obrKind = showBehavioural ? "post-behavioural" : "static";
  const yearLabel = fiscalYear(selectedYear);
  const rows = comparisonRows(selectedRows, selectedPolicies, selectedYear, showBehavioural, catalogue);
  const hasBothTypes = selectedRows.some((row) => row.obr_static !== null && row.obr_behavioural !== null);
  // The last year the official costings cover, for a year past it
  const officialYears = selectedRows
    .filter((row) => isValue(row.obr_static) || isValue(row.obr_behavioural))
    .map((row) => Number(row.year));
  const yearCovered = rows.some((row) => row.obr !== null);
  const lastOfficial = officialYears.length ? Math.max(...officialYears) : null;
  const notCovered = `${yearLabel} is not in the official costings${lastOfficial !== null && lastOfficial < selectedYear ? `, which run to ${fiscalYear(lastOfficial)}` : ""}.`;

  const title = `How our estimates compare with the official costings, ${yearLabel}`;
  const sentence = yearCovered ? comparisonSentence(rows, obrKind) : notCovered;

  // One CSV for both views: the table's columns
  const csv = () =>
    buildChartCsv({
      title,
      units: "£ billion a year; positive values raise revenue or reduce spending",
      source: `PolicyEngine UK microsimulation; official figures from ${SOURCES.obr_budget_2026_costings.label}`,
      columns: [
        { key: "name", label: "Measure" },
        { key: "pe", label: "PolicyEngine, static (£bn)", decimals: 4 },
        { key: "obrStatic", label: "Official, static (£bn)", decimals: 4 },
        { key: "obrBehavioural", label: "Official, post-behavioural (£bn)", decimals: 4 },
        { key: "difference", label: `Difference, PolicyEngine minus official ${obrKind} (£bn)`, decimals: 4 },
      ],
      rows: rows.map((row) => ({
        name: row.name,
        pe: row.pe ?? undefined,
        obrStatic: row.obrStatic ?? undefined,
        obrBehavioural: row.obrBehavioural ?? undefined,
        difference: row.pe !== null && row.obr !== null ? row.pe - row.obr : undefined,
      })),
    });
  // The download follows the view: the table offers its CSV only
  const download = {
    chartRef,
    name: `policyengine-official-costings-${selectedYear}`,
    csv,
    image: !showTable && yearCovered,
    exportOptions: {
      title,
      description: `Each row shows a measure's budgetary impact in ${yearLabel}, in £ billion: PolicyEngine's static estimate and the official ${obrKind} costing, with the difference (PolicyEngine minus official) at the right. Positive values raise revenue or reduce spending.`,
      legendItems: dumbbellLegendItems(obrKind),
      logo: CHART_LOGO,
      svgSelector: "svg",
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

  const cell = (value) => (isValue(value) ? formatBn(value) : "—");

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
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col" className="source-header pe">PolicyEngine</th>
                  <th scope="col" className="source-header obr">Official static</th>
                  <th scope="col" className="source-header obr">Official post-behavioural</th>
                  <th scope="col" className="source-header">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="policy-name-cell">{row.name}</td>
                    <td className="value-cell pe">{cell(row.pe)}</td>
                    <td className="value-cell obr">{cell(row.obrStatic)}</td>
                    <td className="value-cell obr">{cell(row.obrBehavioural)}</td>
                    <td className="value-cell difference">
                      {row.pe !== null && row.obr !== null ? formatDifference(row.pe - row.obr) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="comparison-table-note">
              Difference: PolicyEngine minus the official {obrKind} costing, £bn.
            </p>
          </div>
        )}
      </SwapTransition>

      <div className="chart-footer">
        <ChartMoreInfo info={COMPARISON_INFO} />
      </div>
    </div>
  );
}

export default OBRComparisonTable;

/**
 * The comparison's card on Public finances, under Revenue impact, once the
 * official costings cover any selected measure; nothing until then (no
 * pending line: nothing may stop being true on Budget day, c4717870).
 */
export function ObrComparisonCard({ selectedPolicies, selectedYear }) {
  const data = useObrComparisonData();
  if (!data || selectedPolicies.length === 0) return null;
  // Not published yet, a file that does not check, or no official figure
  // for the selection: nothing at all
  if (data.pending || data.unavailable || !hasObrFigures(data.rows, selectedPolicies)) return null;
  return (
    <section id="obr-comparison" className="report-section hero-chart">
      <OBRComparisonTable selectedPolicies={selectedPolicies} selectedYear={selectedYear} data={data} />
    </section>
  );
}

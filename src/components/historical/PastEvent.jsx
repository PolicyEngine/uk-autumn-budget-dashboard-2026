/**
 * A past fiscal event, replayed on today's model and data
 * (docs/historical-releases.md), as the dashboard shows it when the event is
 * the selected release (App.jsx).
 *
 * Every figure comes from the event's own release root: its manifest, the
 * artifacts the manifest approves, and the flat views its release index
 * binds to that manifest. A manifest for another release, this Budget's
 * included, authorises nothing here (utils/publication/release.js). The
 * page says plainly that the figures are on today's model and data, not
 * what was estimated at the time, and shows how much of the event they
 * cover and what they leave out.
 */
import BudgetaryImpactChart from "../BudgetaryImpactChart";
import DistributionalChart from "../DistributionalChart";
import WaterfallChart from "../WaterfallChart";
import SectionHeading from "../SectionHeading";
import Disclosure from "../Disclosure";
import UnavailableNotice from "../publication/UnavailableNotice";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { loadVerifiedFlatCsv } from "../../utils/publication/flat";
import { fiscalYearLabel } from "../../utils/publication/format";
import {
  accountsForEveryMeasure,
  CLASS_LABELS,
  CLASS_NOTES,
  CLASSES,
  coverageProblems,
  eventDate,
  formatShare,
  gapLabel,
  groupNotModelled,
  parseCoverage,
  parseHistoricalObr,
  parseNotModelled,
  releasePair,
  toNumber,
} from "../../utils/historical";
import "./PastEvent.css";

export const SCORECARD_URL = "https://policyengine-scorecard.vercel.app/scorecard/?country=uk&view=validation";

// A past event has no Treasury costing to await (question 1), so its
// provisional figures carry their own label, not this Budget's
export const HISTORICAL_PROVISIONAL_LABEL = "Provisional: these figures are not yet approved";

const FLAT_VIEWS = ["coverage.csv", "not_modelled.csv", "obr_comparison.csv"];

/** £bn to one decimal place, with a true minus; a missing value reads "—". */
export const formatBn = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value).toFixed(1);
  return `${value < 0 && rounded !== "0.0" ? "−" : ""}£${rounded}bn`;
};

/**
 * The three flat views, each read and checked on its own: one that fails
 * to load or does not add up is unavailable, and the others still show.
 */
export async function loadHistoricalViews(catalogue, { signal } = {}) {
  const [coverage, notModelled, obr] = await Promise.all(
    FLAT_VIEWS.map((file) => loadVerifiedFlatCsv(file, catalogue, { signal }).then(
      (text) => ({ text }),
      (error) => {
        if (error?.name === "AbortError") throw error;
        return { error: error.message };
      },
    )),
  );
  const read = (loaded, parse) => {
    if (loaded.error) return { error: loaded.error };
    try {
      return { value: parse(loaded.text) };
    } catch (error) {
      return { error: error.message };
    }
  };
  const views = {
    coverage: read(coverage, parseCoverage),
    notModelled: read(notModelled, parseNotModelled),
    obr: read(obr, parseHistoricalObr),
  };
  // A check that throws makes only its own view unavailable, never the page
  const failsCheck = (check) => {
    try {
      return check();
    } catch (error) {
      return [error.message];
    }
  };
  if (views.coverage.value) {
    const problems = failsCheck(() => coverageProblems(views.coverage.value));
    if (problems.length) views.coverage = { error: `The coverage table does not add up: ${problems.join("; ")}` };
  }
  // Every measure of the event is either on this page or listed as not
  // modelled; if the files disagree, neither list is shown as complete
  if (views.coverage.value && views.notModelled.value) {
    const unaccounted = failsCheck(() => (accountsForEveryMeasure(views.coverage.value, views.notModelled.value, Object.keys(catalogue.manifest.measures)) ? [] : ["unaccounted"]));
    if (unaccounted.length) views.notModelled = { error: "The list of measures not modelled does not match the event's coverage" };
  }
  return views;
}

/**
 * The event's coverage in the scorecard's accounting, which is of the
 * replay, beside how many of the page's own measures have figures here: a
 * measure the replay computed can still be held, not computable or
 * unavailable on this page.
 */
export function CoveragePanel({ coverage, measures }) {
  const { classes, gaps, computed } = coverage;
  // Each count is a safe integer; their sum need not be
  const total = String(CLASSES.reduce((count, name) => count + BigInt(classes[name].measures), 0n));
  const shown = measures.filter((measure) => measure.availability.available).length;
  const row = (key, label, entry, note, sub = false) => (
    <tr key={key} className={sub ? "coverage-sub" : undefined}>
      <th scope="row">
        <span className="coverage-label">{label}</span>
        {note && <span className="coverage-note">{note}</span>}
      </th>
      <td>{entry.measures}</td>
      <td>{formatShare(entry.shareOfMeasures)}</td>
      <td>{formatShare(entry.shareOfAbsolute)}</td>
    </tr>
  );
  return (
    <div className="coverage-panel">
      <p>
        The scorecard sorts each of the event's {total} measures into one class.
        Its replay computed {computed.measures} of the {total}, covering{" "}
        {formatShare(computed.shareOfAbsolute)} of the value of the OBR's costing.
        This page has figures for {shown} of its {measures.length} measures
        {shown < measures.length ? "; the others are listed above as unavailable." : "."}
      </p>
      <div className="table-scroll">
        <table className="coverage-table">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Measures</th>
              <th scope="col">Share of measures</th>
              <th scope="col">Share of OBR value</th>
            </tr>
          </thead>
          <tbody>
            {CLASSES.flatMap((name) => [
              row(name, CLASS_LABELS[name], classes[name], CLASS_NOTES[name]),
              ...(name === "not_expressible"
                ? Object.entries(gaps).sort(([a], [b]) => (a < b ? -1 : 1)).map(([gap, entry]) => row(`${name}:${gap}`, gapLabel(gap), entry, null, true))
                : []),
            ])}
          </tbody>
          <tfoot>
            {row("computed", "Computed by the replay", computed, "The measures the scorecard's replay costed, on its own model and data.")}
          </tfoot>
        </table>
      </div>
      <p className="coverage-footnote">
        Shares of value are of the absolute value of every OBR costing cell,
        by head and year, so gains and costs do not cancel. Measure counts use
        each measure's one class; values use each costing row's class, so the
        business heads of a partly expressible measure count as outside
        household scope. Shares are rounded from exact fractions.
      </p>
    </div>
  );
}

function NotModelledList({ rows }) {
  const groups = groupNotModelled(rows);
  return (
    <div className="not-modelled">
      {groups.map(({ classification, gap, items }) => (
        <section key={`${classification}:${gap ?? ""}`} className="not-modelled-group">
          <h3>
            {CLASS_LABELS[classification]}
            {gap && <span className="not-modelled-gap">: {gapLabel(gap)}</span>}
            <span className="not-modelled-count"> ({items.length})</span>
          </h3>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <p className="not-modelled-name">
                  {item.name}
                  <span className="not-modelled-value"> OBR costing, all heads and years, in absolute value: {formatBn(toNumber(item.obrAbsolute) / 1e9)}</span>
                </p>
                {item.reason && <p className="not-modelled-reason">{item.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HistoricalObrTable({ rows, budgetary, selectedPolicies, selectedYear }) {
  const catalogue = useMeasureCatalogue();
  const pair = rows.find((row) => row.pair)?.pair;
  const measures = catalogue.displayable.filter((measure) => selectedPolicies.includes(measure.id));
  const lines = measures.map((measure) => {
    const obr = rows.find((row) => row.id === measure.id && row.year === selectedYear);
    const own = budgetary.find((row) => row.reform_id === measure.id && Number(row.year) === selectedYear);
    const value = own && own.value !== "" && Number.isFinite(Number(own.value)) ? Number(own.value) : null;
    return { measure, obr, value };
  });
  if (!lines.length) return null;
  return (
    <div className="historical-obr">
      <p className="comparison-description">
        The OBR's costing of each measure at the time, by tax and spending
        head as the scorecard records it, beside this page's figure on today's
        model and data, for {fiscalYearLabel(selectedYear)}. The OBR's figures
        include heads PolicyEngine does not model, so the second column keeps
        only the heads the replay models. In £ billion; positive values raise
        revenue or reduce spending. The comparison is shown for context and
        does not decide whether a figure is published.
      </p>
      <div className="table-scroll">
        <table className="historical-obr-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">OBR, all heads</th>
              <th scope="col">OBR, heads modelled</th>
              <th scope="col">This page</th>
              <th scope="col">Scorecard replay<sup>*</sup></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ measure, obr, value }) => (
              <tr key={measure.id}>
                <th scope="row">{measure.name}</th>
                <td>{formatBn(obr?.obr)}</td>
                <td>{formatBn(obr?.obrModelled)}</td>
                <td>{formatBn(value)}</td>
                <td>{formatBn(obr?.replay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="coverage-footnote">
        <sup>*</sup> The scorecard's replay of the same construction
        {pair ? ` on its own model and data (${pair})` : " on its own model and data"}.
        It can differ from this page's figure, which runs on this
        dashboard's model and data. See the{" "}
        <a href={SCORECARD_URL} target="_blank" rel="noopener noreferrer">scorecard</a>{" "}
        for the replay and its validation.
      </p>
    </div>
  );
}

/** The years a past event's figures span, as "2025-26 to 2029-30". */
function yearSpan(years) {
  if (!years.length) return null;
  return years.length === 1
    ? fiscalYearLabel(years[0])
    : `${fiscalYearLabel(years[0])} to ${fiscalYearLabel(years[years.length - 1])}`;
}

/**
 * In place of this Budget's intro: the event's figures are on today's model
 * and data, not what was estimated at the time.
 */
export function PastEventBanner({ release, years }) {
  const catalogue = useMeasureCatalogue();
  const pair = releasePair(catalogue.manifest);
  const span = yearSpan(years);
  return (
    <div className="historical-banner" role="note">
      <p className="historical-banner-lead">
        Today's model and data, not what was known at the time.
      </p>
      <p>
        These figures cost the measures of the {release.name} ({eventDate(release.date)})
        on {pair ?? "this dashboard's current model and data"}, each as the difference it makes to
        today's law{span ? `, for ${span}` : ""}. They are not the estimates published at the
        time. Each measure's description says how it is constructed and what it leaves out.
      </p>
    </div>
  );
}

/**
 * Population impact for a past event: its coverage, the revenue and decile
 * charts with the OBR comparison, and its measures, modelled and not. A past
 * event has no other view (question 4).
 */
export function PastEventPopulation({ published, views, selectedPolicies, selectedYear, years, budgetData, emptyState, note }) {
  const catalogue = useMeasureCatalogue();
  const rawDistributional = published.distributional.filter((row) => selectedPolicies.includes(row.reform_id));
  const rawWinnersLosers = published.winnersLosers.filter((row) => selectedPolicies.includes(row.reform_id));
  return (
    <>
      {note}
      <SectionHeading title="Coverage" subtitle="How much of the event the scorecard's replay computed, and how much of it has figures here." />
      <section id="coverage" className="report-section">
        {views.coverage.value
          ? <CoveragePanel coverage={views.coverage.value} measures={catalogue.measures} />
          : <UnavailableNotice reason="The coverage of this event is unavailable"><p>{views.coverage.error}</p></UnavailableNotice>}
      </section>

      {years.length === 0 ? (
        <div className="empty-state">
          <p>No figures for this event are published yet.</p>
        </div>
      ) : selectedPolicies.length === 0 ? (
        emptyState
      ) : (
        <div className="results-container">
          <SectionHeading title="Public finances" subtitle="Net effect of the selected measures on government revenue and spending, by year." />
          <section id="revenue" className="report-section hero-chart">
            <BudgetaryImpactChart
              data={budgetData}
              selectedYear={selectedYear}
            />
            <p className="historical-sum-note">
              The net impact is the sum of the measures, each costed on its
              own against today's law, not one run of the whole event.
            </p>
            <Disclosure id="obr-comparison" inCard title="Compare with the OBR's costing" contentClassName="obr-content">
              {views.obr.value
                ? <HistoricalObrTable rows={views.obr.value} budgetary={published.budgetary} selectedPolicies={selectedPolicies} selectedYear={selectedYear} />
                : <UnavailableNotice reason="The OBR comparison is unavailable"><p>{views.obr.error}</p></UnavailableNotice>}
            </Disclosure>
          </section>

          <SectionHeading title="Households by income" subtitle="How net income changes across the income distribution in the selected year." />
          <section id="deciles" className="report-section distributional-section">
            <div className="charts-grid">
              <WaterfallChart rawData={rawWinnersLosers} selectedPolicies={selectedPolicies} selectedYear={selectedYear} years={years} />
              <DistributionalChart rawData={rawDistributional} selectedPolicies={selectedPolicies} selectedYear={selectedYear} years={years} />
            </div>
          </section>
        </div>
      )}

      <SectionHeading title="Measures" subtitle="What each modelled measure does, and the measures this page does not model." />
      <section id="policy-details" className="report-section">
        <Disclosure title="About the modelled measures" contentClassName="policy-details-content">
          <div className="policy-grid">
            {catalogue.measures.map((measure) => (
              <div key={measure.id} className="policy-detail">
                <p className="policy-detail-name">{measure.name}</p>
                <p className="policy-detail-text">{measure.description}</p>
              </div>
            ))}
          </div>
        </Disclosure>
        <Disclosure title="Measures not modelled" contentClassName="policy-details-content">
          {views.notModelled.value
            ? <NotModelledList rows={views.notModelled.value} />
            : <UnavailableNotice reason="The list of measures not modelled is unavailable"><p>{views.notModelled.error}</p></UnavailableNotice>}
        </Disclosure>
      </section>

      <p className="historical-scorecard-link">
        The replay, its coverage across past events and its comparison with
        the OBR are on the{" "}
        <a href={SCORECARD_URL} target="_blank" rel="noopener noreferrer">PolicyEngine scorecard</a>.
      </p>
    </>
  );
}

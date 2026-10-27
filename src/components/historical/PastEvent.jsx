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
 *
 * This module is what the page itself needs (the banner, the label, the
 * loader); the view with its charts is PastEventPopulation.jsx, in the
 * chart views' chunk (components/chartViews.js), which loads on first use.
 */
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { loadVerifiedFlatCsv } from "../../utils/publication/flat";
import { fiscalYearLabel } from "../../utils/publication/format";
import {
  accountsForEveryMeasure,
  coverageProblems,
  eventDate,
  parseCoverage,
  parseHistoricalObr,
  parseNotModelled,
  releasePair,
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


/**
 * What a view of results by area can show for a selection, as plain data:
 * the published rows, or a notice saying why there are none. A notice
 * never stands in for a figure.
 */

import { fiscalYearLabel } from "../publication/format";
import { hasReform, rowsFor } from "./rows";

/** The region view's element id, so other views can point to it. */
export const REGION_VIEW_ID = "results-by-region";

const notice = (reason, detail = null, extra = {}) => ({
  kind: "notice",
  reason,
  detail,
  ...extra,
});

/**
 * Whether the release says it routes no results by area, so that the views
 * of the areas it routes have nothing that belongs to it. Only a file that
 * was read says so: a missing or unreadable one is unknown, and the views
 * show nothing then either (see viewState).
 *
 * @param {{status: string, routing: Object|null}} routing - From
 *   useAreaRouting.
 */
export const areaViewsNotAvailable = (routing) =>
  routing.status === "ready" && routing.routing.areaViews === "not_available";

/**
 * Whether the release says it routes results by area: the only answer on
 * which the views of the areas it routes show their file.
 *
 * @param {{status: string, routing: Object|null}} routing - From
 *   useAreaRouting.
 */
export const areaViewsAvailable = (routing) =>
  routing.status === "ready" && routing.routing.areaViews === "available";

/**
 * @param {Object} options
 * @param {{status: string, table: Object|null}} options.data - A file's
 *   state, from useGeographyData.
 * @param {Object} options.choice - From chooseSelectionReform.
 * @param {number} options.year
 * @param {string} options.outcome
 * @param {string} options.place - "by region" or "by constituency".
 * @param {{status: string, routing: Object|null}|null} [options.routing] -
 *   From useAreaRouting, for a view of areas the release routes
 *   (constituencies). The view shows its file only once the routing says
 *   the release routes them. When it says the release routes none, the
 *   view says so; when it is missing or can't be read, the view says its
 *   results could not be loaded. Either way it shows nothing from the
 *   file, which may belong to an earlier release. Regions pass none: the
 *   area run publishes them only from an enhanced FRS run, which does not
 *   read the routing.
 * @returns {{kind: "loading"}
 *   | {kind: "notice", reason: string, detail: string|null,
 *      missingReform?: boolean}
 *   | {kind: "rows", reform: string, rows: Array<Object>}}
 */
export function viewState({ data, choice, year, outcome, place, routing = null }) {
  if (routing) {
    // Wait for the routing, so a file from an earlier release never shows
    // while it loads.
    if (routing.status === "loading") return { kind: "loading" };
    if (areaViewsNotAvailable(routing)) {
      return notice(`Results ${place} are not available on this release.`);
    }
    // Nor once it has failed to load: only a routing that says available
    // lets the file show.
    if (!areaViewsAvailable(routing)) {
      return notice(`The page could not load results ${place}.`);
    }
  }
  if (data.status === "loading") return { kind: "loading" };
  if (data.status === "unavailable") {
    return notice(`We have not yet published results ${place}.`);
  }
  if (data.status === "stale") {
    return notice(
      "We have published newer results since this page loaded.",
      "Reload the page to see them.",
    );
  }
  if (data.status !== "ready") {
    return notice(
      `We have not yet published results ${place}.`,
      "The page could not read the published file, so it shows no figures.",
    );
  }
  if (choice.kind === "none") {
    return notice(`Select a policy to see results ${place}.`);
  }
  if (choice.kind === "no-package") {
    if (choice.reason) return notice(choice.reason);
    return notice(`We have not yet published results ${place} for the full package.`);
  }
  if (!hasReform(data.table, choice.reform)) {
    return notice(
      `We have not yet published results ${place} for this policy.`,
      null,
      { missingReform: true },
    );
  }
  const rows = rowsFor(data.table, { reform: choice.reform, year, outcome });
  if (rows.length === 0) {
    return notice(
      `We publish no results ${place} for this policy in ${fiscalYearLabel(year)}.`,
    );
  }
  return { kind: "rows", reform: choice.reform, rows };
}

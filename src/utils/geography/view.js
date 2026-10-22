/**
 * What a view of results by area or group can show for a selection, as
 * plain data: the published rows, or a notice saying why there are none.
 * A notice never stands in for a figure.
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

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * @param {Object} options
 * @param {{status: string, table: Object|null}} options.data - A file's
 *   state, from useGeographyData or useDemographicsData.
 * @param {Object} options.choice - From chooseReform.
 * @param {number} options.year
 * @param {string} [options.outcome] - Every outcome when not given.
 * @param {string} [options.level] - For a file of several levels.
 * @param {string} [options.place] - "by region" or "by constituency".
 * @param {string} [options.subject] - What the notices call the figures
 *   (default "results <place>").
 * @returns {{kind: "loading"}
 *   | {kind: "notice", reason: string, detail: string|null,
 *      missingReform?: boolean}
 *   | {kind: "rows", reform: string, rows: Array<Object>}}
 */
export function viewState({
  data,
  choice,
  year,
  outcome,
  level,
  place,
  subject = `results ${place}`,
}) {
  const Subject = capitalised(subject);
  if (data.status === "loading") return { kind: "loading" };
  if (data.status === "unavailable") {
    return notice(`${Subject} are not yet published.`);
  }
  if (data.status !== "ready") {
    return notice(
      `${Subject} are not yet published.`,
      "The published file could not be read, so no figures are shown.",
    );
  }
  if (choice.kind === "none") {
    return notice(`Select a measure to see ${subject}.`);
  }
  if (choice.kind === "pick") {
    return notice(
      `${Subject} are shown for one measure at a time, or for all measures together.`,
      "Select one measure, or all of them. Figures for different measures are published separately and are not added together.",
    );
  }
  if (choice.kind === "no-package") {
    return notice(`${Subject} are not yet published for the full package.`);
  }
  if (!hasReform(data.table, choice.reform)) {
    return notice(
      `${Subject} are not yet published for this measure.`,
      null,
      { missingReform: true },
    );
  }
  const rows = rowsFor(data.table, {
    reform: choice.reform,
    year,
    outcome,
    level,
  });
  if (rows.length === 0) {
    return notice(
      `No ${subject} are published for this measure in ${fiscalYearLabel(year)}.`,
    );
  }
  return { kind: "rows", reform: choice.reform, rows };
}

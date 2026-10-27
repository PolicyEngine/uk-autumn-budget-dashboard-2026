/**
 * Which measures a household chart's legend lists, and which it greys out.
 *
 * Every selected measure is in the legend, in the catalogue's order
 * (measureCatalogue.jsx), in every year, so no measure silently disappears and
 * the legend holds still when the year changes. A measure that moves no
 * household in the year shown is greyed out (`muted`), and the card's
 * "About this chart" (ChartMoreInfo) says why. Tooltips leave out £0 rows; the
 * same panel covers them.
 */
import { isCatalogueRowDisplayable } from "./measureCatalogue";
import { policyDetailsFor, shortNameOf } from "./policyDetails";
import { CHART_COLOURS } from "./chartTheme";
import { DISPLAY_YEARS } from "./displayYears";

/**
 * Measures that are £0 for every household by construction, and why, in the
 * model's own terms. Employer NI: the relief changes only employer
 * National Insurance (budget_measures/employer_ni_relief_ages_21_to_24.py);
 * the engine's wage pass-through reads the unchanged NI parameters, so
 * wages and household incomes are fixed.
 */
// (#185 on #104: told by the published name, so the page keeps no list
// of measures)
export function zeroForHouseholds(measure) {
  return /^employer\b/i.test(measure?.name ?? "")
    ? "Wages are held fixed in this model, so no household's income changes"
    : null;
}

// The swatch of a greyed-out measure, in the export too
export const MUTED_SWATCH = CHART_COLOURS.noChange;

/** Whether a measure is in force at any point in fiscal year `year` (April
 * to March), from its `inForce` months in policyDetails.js. */
export function inForceIn(policy, year) {
  const window = policy?.inForce;
  if (!window) return true;
  const start = `${year}-04`;
  const end = `${year + 1}-03`;
  return window.from <= end && (!window.to || window.to >= start);
}

/**
 * The legend's entries: every selected measure, each with whether it has an
 * effect in the year shown.
 *
 * @param {string[]} selectedPolicies - Selected measure ids
 * @param {(id: string) => boolean} hasEffect - Whether the measure moves
 *   any household in the year shown (strictly non-zero, never a threshold:
 *   a small measure is still a measure)
 * @returns {Array<{id: string, name: string, description: string, muted: boolean}>}
 */
export function legendMembership(catalogue, selectedPolicies, hasEffect) {
  return catalogue.displayable
    .filter((measure) => selectedPolicies.includes(measure.id))
    .map((measure) => ({ id: measure.id, key: measure.seriesKey, name: measure.label ?? measure.name, description: measure.description, muted: !hasEffect(measure.id) }));
}

/**
 * legendMembership for a published table with a row per measure, year and
 * decile (winners_losers.csv, distributional_impact.csv): a measure has an
 * effect when any decile's `valueKey` is non-zero in `year`.
 */
export function decileMembership(catalogue, rows, valueKey, selectedPolicies, year) {
  const ids = new Set(
    (rows ?? [])
      .filter(
        (row) =>
          row.decile !== "all" &&
          parseInt(row.year) === year &&
          isCatalogueRowDisplayable(catalogue, row.reform_id, row.year) &&
          Math.abs(parseFloat(row[valueKey])) > 0,
      )
      .map((row) => row.reform_id),
  );
  return legendMembership(catalogue, selectedPolicies, (id) => ids.has(id));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// "2027-04" -> "April 2027"
const monthYear = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
// 2027 -> "2027-28"
const fiscalYear = (year) => `${year}-${String(year + 1).slice(-2)}`;

/**
 * When a measure is in force, in words, from its `inForce` months in
 * policyDetails.js: "winter 2026-27 only" for one October-to-March winter,
 * otherwise "in force from April 2031" or "in force December 2026 to May
 * 2027", with "(2031-32 only)" when that is the one year shown it is in
 * force.
 */
export function inForceText(policy) {
  const window = policy?.inForce;
  if (!window) return null;
  const { from, to } = window;
  const fromYear = Number(from.slice(0, 4));
  if (to && from.slice(5) === "10" && to.slice(5) === "03" && Number(to.slice(0, 4)) === fromYear + 1) {
    return `winter ${fiscalYear(fromYear)} only`;
  }
  const years = DISPLAY_YEARS.filter((year) => inForceIn(policy, year));
  const span = to ? `in force ${monthYear(from)} to ${monthYear(to)}` : `in force from ${monthYear(from)}`;
  // "(2031-32 only)" only when the whole window starts in that one year, so
  // a measure also in force before the first year shown is never "only" its
  // last part
  const startYear = Number(from.slice(5, 7)) >= 4 ? fromYear : fromYear - 1;
  return years.length === 1 && years[0] === startYear ? `${span} (${fiscalYear(years[0])} only)` : span;
}

/**
 * When a measure is in force, short, for a list of the policies with no
 * effect: "from April 2031", "December 2026 to May 2027", "winter 2026-27".
 */
export function inForceShort(policy) {
  const window = policy?.inForce;
  if (!window) return null;
  const { from, to } = window;
  const fromYear = Number(from.slice(0, 4));
  if (to && from.slice(5) === "10" && to.slice(5) === "03" && Number(to.slice(0, 4)) === fromYear + 1) {
    return `winter ${fiscalYear(fromYear)}`;
  }
  return to ? `${monthYear(from)} to ${monthYear(to)}` : `from ${monthYear(from)}`;
}

/**
 * A policy with no effect in `year`, as a "no effect" list's row: its short
 * name and, when it is out of force that year, when it is in force.
 */
export function noEffectRow(measure, year) {
  const policy = policyDetailsFor(measure);
  return {
    name: shortNameOf(measure),
    reason: policy && !inForceIn(policy, year) ? inForceShort(policy) : undefined,
  };
}

/**
 * Why a greyed-out measure is £0 for households in `year`, as
 * {kind, text}: "employer" (zeroForHouseholds: £0 by construction),
 * "not_in_force" (when it is in force instead) or "none" (in force, but no
 * household shown is changed).
 */
export function zeroReason(measure, year) {
  const employer = zeroForHouseholds(measure);
  if (employer) return { kind: "employer", text: employer };
  const policy = policyDetailsFor(measure);
  if (!inForceIn(policy, year)) return { kind: "not_in_force", text: inForceText(policy) };
  return { kind: "none", text: "no change for the households shown" };
}

/** The legend items (GroupedLegend `items`), greyed out where muted. */
export function legendItems(members, catalogue) {
  return members.map(({ key, name, muted }) => ({
    key,
    label: name,
    color: muted ? MUTED_SWATCH : catalogue.policyColors[key],
    raises: catalogue.revenueRaisingNames.has(key),
    direction: catalogue.bySeriesKey.get(key)?.direction,
    muted,
  }));
}

/** The same items for the PNG/SVG export legend. */
export function exportLegendItems(members, catalogue) {
  return members.map(({ key, name, muted }) => {
    const direction = catalogue.bySeriesKey.get(key)?.direction;
    return {
      color: muted ? MUTED_SWATCH : catalogue.policyColors[key],
      label: name,
      type: "rect",
      group: direction === "revenue" ? "raise" : direction === "cost" ? "cost" : "other",
    };
  });
}

/** The series keys drawn with a value this year (for the net line). */
export const drawnNames = (members) => members.filter((member) => !member.muted).map((member) => member.key);

/**
 * Which measures a household chart's legend lists, and which it greys out.
 *
 * Every selected measure is in the legend, in the legends' order
 * (ALL_POLICY_NAMES), in every year, so no measure silently disappears and
 * the legend holds still when the year changes. A measure that moves no
 * household in the year shown is greyed out (`muted`), and one line under
 * the chart (ZeroMeasuresNote) says why. Tooltips leave out £0 rows; the
 * same line covers them.
 */
import { ALL_POLICY_NAMES, POLICY_COLORS, REVENUE_RAISING_NAMES } from "./policyConfig";
import { POLICIES } from "./policies";
import { CHART_COLOURS } from "./chartTheme";

/**
 * Measures that are £0 for every household by construction, and why, in the
 * model's own terms. Employer NI: the relief changes only employer
 * National Insurance (budget_measures/employer_ni_relief_ages_21_to_24.py);
 * the engine's wage pass-through reads the unchanged NI parameters, so
 * wages and household incomes are fixed.
 */
export const ZERO_FOR_HOUSEHOLDS = {
  employer_ni_relief_under_25s:
    "employers pay less National Insurance, and wages are held fixed in this model, so no household's income changes",
};

// The swatch of a greyed-out measure, in the export too
export const MUTED_SWATCH = CHART_COLOURS.noChange;

/** Whether a measure is in force at any point in fiscal year `year` (April
 * to March), from its `inForce` months in policies.js. */
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
 * @returns {Array<{id: string, name: string, muted: boolean}>}
 */
export function legendMembership(selectedPolicies, hasEffect) {
  return ALL_POLICY_NAMES.map((name) => POLICIES.find((policy) => policy.name === name))
    .filter((policy) => policy && selectedPolicies.includes(policy.id))
    .map((policy) => ({ id: policy.id, name: policy.name, muted: !hasEffect(policy.id) }));
}

/** Why a greyed-out measure is £0 in `year`. */
export function zeroReason(id, year) {
  if (ZERO_FOR_HOUSEHOLDS[id]) return ZERO_FOR_HOUSEHOLDS[id];
  const policy = POLICIES.find((entry) => entry.id === id);
  if (!inForceIn(policy, year)) return "not in force that year";
  return "no change for the households shown";
}

/** The legend items (GroupedLegend `items`), greyed out where muted. */
export function legendItems(members) {
  return members.map(({ name, muted }) => ({
    label: name,
    color: muted ? MUTED_SWATCH : POLICY_COLORS[name],
    raises: REVENUE_RAISING_NAMES.has(name),
    muted,
  }));
}

/** The same items for the PNG/SVG export legend. */
export function exportLegendItems(members) {
  return members.map(({ name, muted }) => ({
    color: muted ? MUTED_SWATCH : POLICY_COLORS[name],
    label: name,
    type: "rect",
    group: REVENUE_RAISING_NAMES.has(name) ? "raise" : "cost",
  }));
}

/** The names drawn with a value this year (for the net line). */
export const drawnNames = (members) => members.filter((member) => !member.muted).map((member) => member.name);

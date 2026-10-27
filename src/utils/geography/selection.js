import { combinedEntryFor } from "../publication/select";

/**
 * Which published reform a card shows for the header's selection.
 *
 * Results are published per reform, never summed by the page: a sum of
 * rounded figures is not a published figure, and adding one policy's
 * figure to another's could narrow a withheld one. So a card shows:
 *
 * - one policy selected: that policy's own run;
 * - several: the published combined run of exactly those policies (the
 *   manifest's verified combined entry for the set, combinedEntryFor);
 * - otherwise the "not published yet" notice. No card picks a policy of
 *   its own: the header's Policies selector is the policy choice, and one
 *   policy never stands in silently for a selection of several. The
 *   constituency card alone offers, in its Options pill, a choice among
 *   the selection's published runs (areaPolicyOptions), named in its title.
 */

/**
 * The name to show for a choice: the measure's own name, or the package.
 *
 * @param {Object} choice - From chooseSelectionReform.
 * @param {Array<{id: string, name: string}>} policies
 */
export function choiceLabel(choice, policies) {
  if (choice.kind === "measure") {
    return (
      (policies ?? []).find((policy) => policy.id === choice.reform)?.name ??
      choice.reform
    );
  }
  if (choice.kind === "package") {
    return choice.members && !choice.all ? "Selected policies (combined)" : "All policies (the full package)";
  }
  return "";
}

/** The measure names a choice covers, for export metadata. */
export function choiceMeasureNames(choice, policies) {
  if (choice.kind === "package" && choice.members) {
    return choice.members.map((id) => (policies ?? []).find((policy) => policy.id === id)?.name ?? id);
  }
  if (choice.kind === "package") {
    return (policies ?? []).map((policy) => policy.name);
  }
  if (choice.kind === "measure") return [choiceLabel(choice, policies)];
  return [];
}

/** A card's notice when the selection's combined run is not published. */
export const selectionNotPublished = (subject) =>
  `${subject} results for this combination of policies are not published yet.`;

/** The constituency card's notice when a selection has no area result. */
export const SELECTION_NOT_PUBLISHED = selectionNotPublished("Constituency");

/**
 * The manifest key of the published combined run of exactly the selected
 * policies, or null (one or no policy selected, no manifest, or no such
 * run published).
 */
export function selectionPackageKey(manifest, selectedIds) {
  if (!manifest || new Set(selectedIds ?? []).size < 2) return null;
  const entry = combinedEntryFor(manifest, selectedIds);
  return entry && !entry.single ? entry.key : null;
}

/**
 * Which published reform a card shows for the header's selection.
 *
 * - one policy selected: that policy's reform;
 * - several: the combined run of exactly those policies (`packageKey`, the
 *   manifest's verified combined entry for the set, from combinedEntryFor),
 *   when the card's data has rows for it;
 * - otherwise `no-package` with the notice to show. One policy's results
 *   never stand in for the selection's, and figures are never summed.
 *
 * @param {{selectedIds: Array<string>, policyIds: Array<string>,
 *   reforms: Iterable<string>, packageKey?: string|null, reason?: string}}
 *   options - `reason`: the card's not-published notice
 * @returns {{kind: "none"}
 *   | {kind: "measure", reform: string}
 *   | {kind: "package", reform: string, members: string[], all: boolean}
 *   | {kind: "no-package", reason: string, members: string[], all: boolean}}
 */
export function chooseSelectionReform({
  selectedIds,
  policyIds,
  reforms,
  packageKey = null,
  reason = SELECTION_NOT_PUBLISHED,
}) {
  const ids = [...new Set(selectedIds ?? [])];
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "measure", reform: ids[0] };
  const order = policyIds ?? [];
  const members = [...ids].sort((a, b) => {
    const left = order.indexOf(a);
    const right = order.indexOf(b);
    return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right);
  });
  const all = order.length > 0 && order.length === ids.length && order.every((id) => ids.includes(id));
  if (typeof packageKey === "string" && [...(reforms ?? [])].includes(packageKey)) {
    return { kind: "package", reform: packageKey, members, all };
  }
  return { kind: "no-package", reason, members, all };
}

/** The constituency card's Policy option for the selection's combined run. */
export const COMBINED_CHOICE = "combined";

/**
 * The constituency card's Policy options, an explicit choice in its
 * Options pill: the selection's published combined run (when one is
 * published for exactly the selected policies and the card's file has
 * rows for it), then each selected policy, in the page's order, whose own
 * run the file has. Each option is one published run, never a sum.
 *
 * The default is the combined run when published, else the first single
 * policy with results, so the card never says "not published" while a
 * selected policy has a map. No options (null default) leaves the card's
 * notice as chooseSelectionReform gives it.
 *
 * @param {{selectedIds: Array<string>, policyIds: Array<string>,
 *   packageKey?: string|null, hasArea: (reform: string) => boolean}} options
 * @returns {{options: Array<{value: string, reform: string}>,
 *   defaultValue: string|null}}
 */
export function areaPolicyOptions({ selectedIds, policyIds, packageKey = null, hasArea }) {
  const ids = [...new Set(selectedIds ?? [])];
  const order = policyIds ?? [];
  const rank = (id) => (order.indexOf(id) < 0 ? Infinity : order.indexOf(id));
  const options = [];
  if (ids.length > 1 && typeof packageKey === "string" && hasArea(packageKey)) {
    options.push({ value: COMBINED_CHOICE, reform: packageKey });
  }
  for (const id of [...ids].sort((a, b) => rank(a) - rank(b))) {
    if (hasArea(id)) options.push({ value: id, reform: id });
  }
  return { options, defaultValue: options[0]?.value ?? null };
}

/**
 * The card's choice for a Policy option (`value`, kept only while it is
 * offered; else the default), as chooseSelectionReform's shape: the
 * combined run as the package, a single policy as its own measure. With
 * no option, chooseSelectionReform's choice (its notice).
 */
export function chooseAreaPolicy({ value, selectedIds, policyIds, reforms, packageKey = null, hasArea }) {
  const { options, defaultValue } = areaPolicyOptions({ selectedIds, policyIds, packageKey, hasArea });
  const chosen = options.some((option) => option.value === value) ? value : defaultValue;
  const base = chooseSelectionReform({ selectedIds, policyIds, reforms, packageKey });
  if (chosen === null || chosen === COMBINED_CHOICE) return { choice: base, options, value: chosen };
  return { choice: { kind: "measure", reform: chosen }, options, value: chosen };
}

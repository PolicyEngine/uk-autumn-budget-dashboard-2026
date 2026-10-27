/**
 * Which published reform the results by area show for a selection.
 *
 * Results by area are published per reform, never summed by the page:
 * a sum of rounded figures is not a published figure, and adding one
 * measure's figure to another's could narrow a withheld one. So:
 *
 * - one measure selected: that measure's reform;
 * - every measure selected: the package, which the page names: the
 *   combined run of exactly the displayable measures in the approved
 *   manifest (`packageId`, the catalogue's combinedId). Nothing else is
 *   ever taken for it;
 * - anything else ("pick", or "no-package" when every measure is selected
 *   but no package is published): focusChoice shows one selected measure
 *   at a time, chosen in the card's Measure picker.
 */

/**
 * @param {{selectedIds: Array<string>, policyIds: Array<string>,
 *   reforms: Iterable<string>, packageId?: string|null}} options - The
 *   selected measure ids, every measure the page offers, the reforms the
 *   published data carries, and the package's id (null or omitted when no
 *   package is published).
 * @returns {{kind: "none"}
 *   | {kind: "measure", reform: string}
 *   | {kind: "package", reform: string}
 *   | {kind: "pick"}
 *   | {kind: "no-package"}} `pick` when several measures but not all are
 *   selected; `no-package` when all are, but the data has no single
 *   package reform.
 */
export function chooseReform({ selectedIds, policyIds, reforms, packageId }) {
  const selected = new Set(selectedIds ?? []);
  if (selected.size === 0) return { kind: "none" };
  if (selected.size === 1) return { kind: "measure", reform: [...selected][0] };
  const all = new Set(policyIds ?? []);
  const everyMeasure =
    selected.size === all.size && [...selected].every((id) => all.has(id));
  if (!everyMeasure) return { kind: "pick" };
  if (typeof packageId !== "string" || ![...(reforms ?? [])].includes(packageId)) {
    return { kind: "no-package" };
  }
  return { kind: "package", reform: packageId };
}

/**
 * The name to show for a choice: the measure's own name, or the package.
 *
 * @param {Object} choice - From chooseReform.
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

/**
 * A selection with no single published reform ("pick", "no-package"): one
 * selected measure at a time. `focusId` is the reader's choice; otherwise
 * the measure with the largest `size` (e.g. the mean absolute change in the
 * year). Measures the data does not carry are not offered.
 *
 * @returns {Object} the choice unchanged, or {kind: "measure", reform,
 *   focus: {options: string[]}} (options: the offered measure ids, in the
 *   page's order)
 */
export function focusChoice(choice, { selectedIds, policyIds, reforms, focusId = null, size = () => 0 }) {
  if (choice.kind !== "pick" && choice.kind !== "no-package") return choice;
  const carried = new Set(reforms ?? []);
  const options = (policyIds ?? []).filter((id) => (selectedIds ?? []).includes(id) && carried.has(id));
  if (!options.length) return choice;
  const reform = options.includes(focusId)
    ? focusId
    : options.reduce((best, id) => (size(id) > size(best) ? id : best), options[0]);
  return { kind: "measure", reform, focus: { options } };
}

/** The constituency card's notice when a selection has no area result. */
export const SELECTION_NOT_PUBLISHED =
  "Constituency results for this combination of policies are not published yet.";

/**
 * Which published reform the constituency views show for a selection: the
 * selection itself, as every other chart on the page does.
 *
 * - one policy selected: that policy's reform;
 * - several: the combined run of exactly those policies (`packageKey`, the
 *   manifest's verified combined entry for the set, from combinedEntryFor),
 *   when the area run published rows for it;
 * - otherwise `no-package` with the notice to show. One policy's results
 *   never stand in for the selection's, and figures are never summed.
 *
 * @param {{selectedIds: Array<string>, policyIds: Array<string>,
 *   reforms: Iterable<string>, packageKey?: string|null}} options
 * @returns {{kind: "none"}
 *   | {kind: "measure", reform: string}
 *   | {kind: "package", reform: string, members: string[], all: boolean}
 *   | {kind: "no-package", reason: string, members: string[], all: boolean}}
 */
export function chooseSelectionReform({ selectedIds, policyIds, reforms, packageKey = null }) {
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
  return { kind: "no-package", reason: SELECTION_NOT_PUBLISHED, members, all };
}

/**
 * The card's optional per-policy view of a selection of several policies.
 * The default (`focusId` null, or one no longer offered) is the selection
 * itself; a reader who picks one policy sees that policy alone, named.
 *
 * @returns {Object} the choice with `focus: {options}` added (options: the
 *   selected policies with constituency results, in the page's order), or,
 *   for a picked policy, {kind: "measure", reform, focus: {options}}.
 */
export function selectionFocus(choice, { reforms, focusId = null }) {
  if (choice.kind !== "package" && choice.kind !== "no-package") return choice;
  const carried = new Set(reforms ?? []);
  const options = choice.members.filter((id) => carried.has(id));
  if (!options.length) return choice;
  if (focusId && options.includes(focusId)) {
    return { kind: "measure", reform: focusId, focus: { options, selection: choice } };
  }
  return { ...choice, focus: { options } };
}

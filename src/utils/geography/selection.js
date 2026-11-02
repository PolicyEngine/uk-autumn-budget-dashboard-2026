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
 *   constituency map alone, with no combined run by constituency, stacks
 *   the selected policies' own rows (stack.js; Vahid, 28 October).
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
  if (choice.kind === "stack") {
    return choice.all ? "All policies (each policy's effect added up)" : "Selected policies (each policy's effect added up)";
  }
  return "";
}

/** The measure names a choice covers, for export metadata. */
export function choiceMeasureNames(choice, policies) {
  if ((choice.kind === "package" || choice.kind === "stack") && choice.members) {
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

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const numberWord = (count) => NUMBER_WORDS[count] ?? String(count);

/**
 * A card drawn from one published run at a time (a policy's own, or the
 * full package's) when some but not all policies are selected: no run is
 * published for that set, and its figures cannot be added up (the
 * household scatter's cells lose which household is which). Not "yet":
 * such a run is never published. `count`: every policy the page offers.
 */
export const oneRunAtATime = (count) =>
  `This chart shows one policy at a time, or all ${numberWord(count)} together.`;
/** The notice's buttons: every policy, or the first selected alone. */
export const showAllLabel = (count) => `Show all ${numberWord(count)}`;
export const showAloneLabel = (name) => `Show ${name} alone`;

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

/**
 * Which published reform the results by area show for a selection.
 *
 * Results by area are published per reform, never summed by the page:
 * a sum of rounded figures is not a published figure, and adding one
 * measure's figure to another's could narrow a withheld one. So:
 *
 * - one measure selected: that measure's reform;
 * - every measure selected: the package. The page names it: the combined
 *   run of exactly the displayable measures in the approved manifest
 *   (`packageId`). Without that name, the one `_combined` reform in the
 *   published data;
 * - anything else: nothing, and the page asks for one measure or all.
 */

export const PACKAGE_SUFFIX = "_combined";

/** The package reforms among `reforms`, sorted. */
export const packageReforms = (reforms) =>
  [...new Set(reforms ?? [])]
    .filter((reform) => reform.endsWith(PACKAGE_SUFFIX))
    .sort();

/**
 * @param {{selectedIds: Array<string>, policyIds: Array<string>,
 *   reforms: Iterable<string>, packageId?: string|null}} options - The
 *   selected measure ids, every measure the page offers, the reforms the
 *   published data carries, and the package's id (null when no package is
 *   published; omitted only outside the page).
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
  const packages = packageId === undefined
    ? packageReforms(reforms)
    : packageId !== null && [...(reforms ?? [])].includes(packageId) ? [packageId] : [];
  // Two package reforms would leave the page guessing which one is this
  // selection's, so it shows neither.
  if (packages.length !== 1) return { kind: "no-package" };
  return { kind: "package", reform: packages[0] };
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
  if (choice.kind === "package") return "All measures (the full package)";
  return "";
}

/** The measure names a choice covers, for export metadata. */
export function choiceMeasureNames(choice, policies) {
  if (choice.kind === "package") {
    return (policies ?? []).map((policy) => policy.name);
  }
  if (choice.kind === "measure") return [choiceLabel(choice, policies)];
  return [];
}

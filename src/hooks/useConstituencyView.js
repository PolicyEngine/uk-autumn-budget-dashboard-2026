import {
  useAreaRouting,
  useConstituencyBoundaries,
  useGeographyData,
} from "./useGeographyData";
import { hasReform } from "../utils/geography/rows";
import { SELECTION_NOT_PUBLISHED, chooseSelectionReform, selectionPackageKey } from "../utils/geography/selection";
import { stackReform, withStack } from "../utils/geography/stack";
import { shortNameOf } from "../utils/policyDetails";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { viewState } from "../utils/geography/view";

// Stacked tables, by published table and member list, so a selection's
// stack is built once and keeps its identity across renders
const STACKS = new WeakMap();

function stackedTable(table, memberKey) {
  if (!table || !memberKey) return table;
  if (!STACKS.has(table)) STACKS.set(table, new Map());
  const byMembers = STACKS.get(table);
  if (!byMembers.has(memberKey)) {
    const members = JSON.parse(memberKey).map(([id, name]) => ({ id, name }));
    byMembers.set(memberKey, members.length > 1 ? withStack(table, members) : table);
  }
  return byMembers.get(memberKey);
}

/**
 * What the constituency views show for a selection, year and outcome: the
 * map and the rankings under it read this one state, so they always agree
 * on whether there are results, and on every figure. The files behind it
 * are fetched once and shared (useGeographyData), and the same release
 * routing and published-file gate apply to both.
 *
 * `view` is viewState's, narrowed as the map needs it: a measure published
 * only by region says so, and rows wait for the boundaries (the rankings
 * take each seat's name and region from them too).
 *
 * @returns {{view: Object, choice: Object, table: Object|null,
 *   regionalTable: Object|null, boundariesReady: boolean,
 *   features: Array|null, routing: Object, regionalHasChoice: boolean}}
 */
export function useConstituencyView({
  selectedPolicies = [],
  policies = [],
  selectedYear,
  outcome,
}) {
  const constituency = useGeographyData("constituency");
  const regional = useGeographyData("regional");
  const boundaries = useConstituencyBoundaries();
  const routing = useAreaRouting();

  const reforms = [
    ...(constituency.table?.reforms ?? []),
    ...(regional.table?.reforms ?? []),
  ];
  const { manifest } = useMeasureCatalogue();
  const policyIds = policies.filter((policy) => policy.displayable !== false).map((policy) => policy.id);
  // The header's selection, as the other charts take it: one policy, its
  // own run; several, the published combined run of exactly them when the
  // file has rows for it (chooseSelectionReform). Otherwise the map stacks
  // the selected policies' own published rows (stack.js; Vahid, 28
  // October), so it always follows the header and has no policy choice of
  // its own.
  const base = chooseSelectionReform({
    selectedIds: selectedPolicies,
    policyIds,
    reforms,
    packageKey: selectionPackageKey(manifest, selectedPolicies),
  });
  // Stacked when no combined run is published and at least one selected
  // policy has constituency rows: every selected policy is a member (one
  // with no rows counts as zero everywhere, and makes the figures
  // approximate), named as the page names it
  const noAreaRun =
    base.kind === "no-package" || (base.kind === "package" && !hasReform(constituency.table, base.reform));
  const stackable =
    noAreaRun && base.members.some((id) => hasReform(constituency.table, id));
  const memberKey = stackable
    ? JSON.stringify(base.members.map((id) => [id, shortNameOf(policies.find((policy) => policy.id === id) ?? { id })]))
    : null;
  const table = stackedTable(constituency.table, memberKey);
  const choice =
    stackable && base.members.length > 1
      ? { kind: "stack", reform: stackReform(base.members), members: base.members, all: base.all }
      : base;
  let view = viewState({
    data: { ...constituency, table },
    choice,
    year: selectedYear,
    outcome,
    place: "by constituency",
    routing,
  });
  // Whether the region view has this measure, so a notice can point to it.
  const regionalHasChoice =
    Boolean(choice.reform) && hasReform(regional.table, choice.reform);
  if (view.kind === "notice" && view.missingReform && choice.kind === "package") {
    // A combined run published by region only: the selection's notice
    view = { ...view, reason: SELECTION_NOT_PUBLISHED };
  } else if (view.kind === "notice" && view.missingReform && regionalHasChoice) {
    view = {
      ...view,
      reason: "We publish results for this policy by region only.",
    };
  }
  if (view.kind === "rows" && boundaries.status !== "ready") {
    view =
      boundaries.status === "loading"
        ? { kind: "loading" }
        : {
            kind: "notice",
            reason: "The page could not load the constituency boundaries.",
            detail: null,
          };
  }
  return {
    view,
    choice,
    table,
    regionalTable: regional.table,
    features: boundaries.features,
    boundariesReady: boundaries.status === "ready",
    routing,
    regionalHasChoice,
  };
}

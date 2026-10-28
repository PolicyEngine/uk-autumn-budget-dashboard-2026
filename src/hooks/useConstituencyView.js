import {
  useAreaRouting,
  useConstituencyBoundaries,
  useGeographyData,
} from "./useGeographyData";
import { hasReform } from "../utils/geography/rows";
import { SELECTION_NOT_PUBLISHED, chooseAreaPolicy, selectionPackageKey } from "../utils/geography/selection";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { viewState } from "../utils/geography/view";

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
 *   features: Array|null, routing: Object, regionalHasChoice: boolean,
 *   policyOptions: Array<{value: string, reform: string}>,
 *   policyValue: string|null}}
 */
export function useConstituencyView({
  selectedPolicies = [],
  policies = [],
  selectedYear,
  outcome,
  // The card's Policy option ("combined" or a policy id); null for the default
  policyChoice = null,
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
  // The map shows a published run for the header's selection: the
  // verified combined run of exactly the selected policies (the manifest's
  // combined entry for the set, as the other charts take it), or one
  // selected policy's own run, as the card's Policy option chooses
  // (chooseAreaPolicy: combined by default when published, else the first
  // selected policy with constituency rows). Figures are never summed. With
  // no such run the card says so.
  const {
    choice,
    options: policyOptions,
    value: policyValue,
    fallback: policyFallback,
  } = chooseAreaPolicy({
    value: policyChoice,
    selectedIds: selectedPolicies,
    policyIds,
    reforms,
    packageKey: selectionPackageKey(manifest, selectedPolicies),
    hasArea: (reform) => hasReform(constituency.table, reform),
  });
  let view = viewState({
    data: constituency,
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
      reason: "Results for this policy are published by region only.",
    };
  }
  if (view.kind === "rows" && boundaries.status !== "ready") {
    view =
      boundaries.status === "loading"
        ? { kind: "loading" }
        : {
            kind: "notice",
            reason: "The constituency boundaries could not be loaded.",
            detail: null,
          };
  }
  return {
    view,
    choice,
    table: constituency.table,
    regionalTable: regional.table,
    features: boundaries.features,
    boundariesReady: boundaries.status === "ready",
    routing,
    regionalHasChoice,
    policyOptions,
    policyValue,
    policyFallback,
  };
}

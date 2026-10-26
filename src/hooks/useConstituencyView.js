import {
  useAreaRouting,
  useConstituencyBoundaries,
  useGeographyData,
} from "./useGeographyData";
import { hasReform } from "../utils/geography/rows";
import { chooseReform } from "../utils/geography/selection";
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
  const { combinedId } = useMeasureCatalogue();
  const choice = chooseReform({
    selectedIds: selectedPolicies,
    // The package is every measure the page can show, held ones excluded
    policyIds: policies.filter((policy) => policy.displayable !== false).map((policy) => policy.id),
    reforms,
    packageId: combinedId,
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
  if (view.kind === "notice" && view.missingReform && regionalHasChoice) {
    view = {
      ...view,
      reason: "Results for this measure are published by region only.",
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
  };
}

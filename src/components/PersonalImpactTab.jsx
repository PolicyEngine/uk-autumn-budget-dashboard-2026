import HouseholdCalculator from "./HouseholdCalculator";
import UnavailableNotice, { RemoveUnavailable } from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, publishedEngine, useMeasureCatalogue } from "../utils/measureCatalogue";
import { usePublicationCheck } from "../utils/publication/check";
import "./PersonalImpactTab.css";

/**
 * Household impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies.
 */
function PersonalImpactTab({ selectedPolicies = [], policies = [], year, onRemoveUnavailable, active = true }) {
  const catalogue = useMeasureCatalogue();
  const confirmPublication = usePublicationCheck();
  const unavailable = selectedPolicies.filter((id) => !isCatalogueRowDisplayable(catalogue, id, year));
  if (!catalogue.manifest || unavailable.length) {
    const names = unavailable.map((id) => catalogue.byId.get(id)?.name ?? id);
    return (
      <UnavailableNotice reason="Household impact is unavailable for the selected policies">
        <p>{names.join(", ") || "No verified Budget policies are published yet."}</p>
        {catalogue.manifest && onRemoveUnavailable && (
          <RemoveUnavailable names={names} onRemove={() => onRemoveUnavailable(unavailable)} />
        )}
      </UnavailableNotice>
    );
  }
  // The household API answers live; its package versions must be the ones
  // the selected measures' receipts record (useHouseholdImpact)
  const expectedEngine = publishedEngine(catalogue, selectedPolicies);
  if (selectedPolicies.length && !expectedEngine) {
    return (
      <UnavailableNotice reason="Household impact is unavailable for the selected policies">
        <p>Their published figures do not name one model version for the household calculator to match.</p>
      </UnavailableNotice>
    );
  }
  // The examples' precomputed answers are for every published measure, so
  // they are checked against those measures' receipts, whatever is selected
  // now (with none selected there is no expectedEngine at all)
  const presetEngine = publishedEngine(
    catalogue,
    policies.filter((policy) => policy.displayable !== false).map((policy) => policy.id),
  );
  const publicationKey = catalogue.manifest.snapshotSha256 ?? String(catalogue.manifest.revision);
  return (
    <div className="personal-impact-tab">
      <HouseholdCalculator
        key={publicationKey}
        publicationKey={publicationKey}
        selectedPolicies={selectedPolicies}
        policies={policies}
        year={year}
        expectedEngine={expectedEngine}
        presetEngine={presetEngine}
        confirmPublication={confirmPublication}
        active={active}
      />
    </div>
  );
}

export default PersonalImpactTab;

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
      <UnavailableNotice reason="Personal impact is unavailable for the selected measures">
        <p>{names.join(", ") || "No verified Budget measures are published yet."}</p>
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
      <UnavailableNotice reason="Personal impact is unavailable for the selected measures">
        <p>Their published figures do not name one model version for the household calculator to match.</p>
      </UnavailableNotice>
    );
  }
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
        confirmPublication={confirmPublication}
        active={active}
      />
    </div>
  );
}

export default PersonalImpactTab;

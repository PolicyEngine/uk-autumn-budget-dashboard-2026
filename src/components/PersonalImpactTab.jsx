import HouseholdCalculator from "./HouseholdCalculator";
import UnavailableNotice, { RemoveUnavailable } from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import "./PersonalImpactTab.css";

/**
 * Personal impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies.
 */
function PersonalImpactTab({ selectedPolicies = [], policies = [], year, onRemoveUnavailable }) {
  const catalogue = useMeasureCatalogue();
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
  const publicationKey = catalogue.manifest.snapshotSha256 ?? String(catalogue.manifest.revision);
  return (
    <div className="personal-impact-tab">
      <HouseholdCalculator
        key={publicationKey}
        publicationKey={publicationKey}
        selectedPolicies={selectedPolicies}
        policies={policies}
        year={year}
      />
    </div>
  );
}

export default PersonalImpactTab;

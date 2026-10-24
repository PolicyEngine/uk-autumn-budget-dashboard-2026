import HouseholdCalculator from "./HouseholdCalculator";
import UnavailableNotice from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import "./PersonalImpactTab.css";

/**
 * Personal impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies.
 */
function PersonalImpactTab({ selectedPolicies = [], policies = [], year }) {
  const catalogue = useMeasureCatalogue();
  const unavailable = selectedPolicies.filter((id) => !isCatalogueRowDisplayable(catalogue, id, year));
  if (!catalogue.manifest || unavailable.length) {
    return (
      <UnavailableNotice reason="Personal impact is unavailable for the selected measures">
        <p>{unavailable.map((id) => catalogue.byId.get(id)?.name ?? id).join(", ") || "No verified Budget measures are published yet."}</p>
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

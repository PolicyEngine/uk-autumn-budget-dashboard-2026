import HouseholdCalculator from "./HouseholdCalculator";
import UnavailableMeasures from "./publication/UnavailableMeasures";
import UnavailableNotice, { RemoveUnavailable } from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, publishedDefinitions, publishedEngine, useMeasureCatalogue } from "../utils/measureCatalogue";
import { usePublicationCheck } from "../utils/publication/check";
import "./PersonalImpactTab.css";

/**
 * Personal impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies.
 */
function PersonalImpactTab({ selectedPolicies = [], policies = [], year, onRemoveUnavailable }) {
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
  // And it must compute each measure from the definition its receipt
  // approved: a measure with none to check is unavailable, never unchecked
  const { definitions: expectedDefinitions, missing } = publishedDefinitions(catalogue, selectedPolicies);
  if (missing.length) {
    return (
      <UnavailableMeasures
        reason="Personal impact is unavailable for the selected measures"
        summary="The household calculator cannot be checked against these measures' published figures:"
        measures={missing.map(({ id, reason }) => ({ id, name: catalogue.byId.get(id)?.name ?? id, why: [reason] }))}
        onRemove={onRemoveUnavailable}
      />
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
        expectedDefinitions={expectedDefinitions}
        confirmPublication={confirmPublication}
        onRemoveUnavailable={onRemoveUnavailable}
      />
    </div>
  );
}

export default PersonalImpactTab;

import HouseholdCalculator from "./HouseholdCalculator";
import "./PersonalImpactTab.css";

/**
 * Personal impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies.
 */
function PersonalImpactTab({ selectedPolicies, policies, year }) {
  return (
    <div className="personal-impact-tab">
      <HouseholdCalculator
        selectedPolicies={selectedPolicies}
        policies={policies}
        year={year}
      />
    </div>
  );
}

export default PersonalImpactTab;

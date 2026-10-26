import HouseholdCalculator from "./HouseholdCalculator";
import IncomeCurveExamples from "./IncomeCurveExamples";
import "./PersonalImpactTab.css";

/**
 * Household impact: one household's answers, then its net income in the
 * year chosen in the title band before and after the selected policies;
 * below, how five fixed example households' net income changes with income.
 */
function PersonalImpactTab({ selectedPolicies, policies, year, active = true }) {
  return (
    <div className="personal-impact-tab">
      <HouseholdCalculator
        selectedPolicies={selectedPolicies}
        policies={policies}
        year={year}
        active={active}
      />
      <IncomeCurveExamples selectedPolicies={selectedPolicies} year={year} active={active} />
    </div>
  );
}

export default PersonalImpactTab;

import LifecycleCalculator from "./LifecycleCalculator";
import "./PersonalImpactTab.css";

function PersonalImpactTab({ selectedPolicies, policies, onShowMethod }) {
  return (
    <div className="personal-impact-tab">
      <LifecycleCalculator
        selectedPolicies={selectedPolicies}
        policies={policies}
        onShowMethod={onShowMethod}
      />
    </div>
  );
}

export default PersonalImpactTab;

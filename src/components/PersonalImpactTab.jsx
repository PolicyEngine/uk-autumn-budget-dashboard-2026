import LifecycleCalculator from "./LifecycleCalculator";
import "./PersonalImpactTab.css";

function PersonalImpactTab({ selectedPolicies, policies }) {
  return (
    <div className="personal-impact-tab">
      <LifecycleCalculator selectedPolicies={selectedPolicies} policies={policies} />
    </div>
  );
}

export default PersonalImpactTab;

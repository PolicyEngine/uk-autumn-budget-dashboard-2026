import { useLayoutEffect } from "react";
import LifecycleCalculator, { PERSONAL_SUB_TABS } from "./LifecycleCalculator";
import { useSubTabParam } from "./SubTabs";
import "./PersonalImpactTab.css";

const SUB_TAB_VALUES = PERSONAL_SUB_TABS.map((tab) => tab.value);

/**
 * Personal impact: one household's answers, then its results in two
 * sub-tabs, Single-year effect (the default) and Multi-year effect, kept in
 * the address as ?sub=. The open sub-tab is reported to App, which shows
 * the year pill on Single-year only.
 */
function PersonalImpactTab({ selectedPolicies, policies, onShowMethod, year, onSubTabChange }) {
  const [subTab, setSubTab] = useSubTabParam(SUB_TAB_VALUES);

  // Before paint, so the band never shows the wrong pills
  useLayoutEffect(() => {
    onSubTabChange?.(subTab);
  }, [subTab, onSubTabChange]);

  return (
    <div className="personal-impact-tab">
      <LifecycleCalculator
        selectedPolicies={selectedPolicies}
        policies={policies}
        onShowMethod={onShowMethod}
        year={year}
        subTab={subTab}
        onSubTabChange={setSubTab}
      />
    </div>
  );
}

export default PersonalImpactTab;

import { useEffect, useRef, useState } from "react";
import EmploymentIncomeChart from "./EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./EmploymentIncomeDiffChart";
import HouseholdPicker from "./HouseholdPicker";
import SectionHeading from "./SectionHeading";
import { DEFAULT_HOUSEHOLD } from "../utils/exampleHouseholds";

/** The section's anchor; old links to Population impact's #household land here. */
export const INCOME_CURVES_ANCHOR = "household";

/**
 * Household impact's income charts: five fixed households (income_curve.csv,
 * a different set from the calculator's example cards above), each with one
 * income varied from £0, before and after the selected policies in the year
 * chosen in the band. One chooser above both charts, so they always match.
 */
function IncomeCurveExamples({ selectedPolicies, year, active = true }) {
  const [householdId, setHouseholdId] = useState(DEFAULT_HOUSEHOLD);

  // A link to #household (or an old Population impact one): the panel opens
  // after the page loads, so scroll once it is shown
  const scrolled = useRef(false);
  useEffect(() => {
    if (!active || scrolled.current) return;
    if (typeof window === "undefined" || window.location.hash !== `#${INCOME_CURVES_ANCHOR}`) {
      scrolled.current = true;
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrolled.current = true;
      document.getElementById(INCOME_CURVES_ANCHOR)?.scrollIntoView?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div id={INCOME_CURVES_ANCHOR} className="results-container income-curve-examples">
      <SectionHeading
        title="How example households' net income changes with income"
        subtitle="Five fixed households, separate from the example cards above: each chart varies one income from £0 and shows net income before and after the selected policies."
      />
      <div className="example-household-picker">
        <HouseholdPicker value={householdId} onChange={setHouseholdId} />
      </div>
      <section className="report-section charts-grid">
        <EmploymentIncomeChart
          selectedPolicies={selectedPolicies}
          selectedYear={year}
          household={householdId}
          onHouseholdChange={setHouseholdId}
          showPicker={false}
        />
        <EmploymentIncomeDiffChart
          selectedPolicies={selectedPolicies}
          selectedYear={year}
          household={householdId}
          onHouseholdChange={setHouseholdId}
          showPicker={false}
        />
      </section>
    </div>
  );
}

export default IncomeCurveExamples;

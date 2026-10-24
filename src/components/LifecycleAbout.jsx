import { useMeasureCatalogue } from "../utils/measureCatalogue";
import "./LifecycleCalculator.css";

// The model's assumptions, from run_lifecycle_model and LifecycleInputs in
// uk_budget_data/lifecycle_calculator.py
const ASSUMPTIONS = [
  "The projection starts in 2026 at the age and salary entered, and runs to the life expectancy entered.",
  "Earnings follow an age profile that starts at 22: they rise to 2.2 times their level at 22 by 50, then stay there. A salary entered before 22 is held flat until 22.",
  "On top of that profile, earnings grow by 1% a year.",
  "After the retirement age entered, income is the State Pension.",
  "CPI and RPI follow the OBR forecast, then 2% and 2.39%.",
];

/** Public descriptions are shared with the measure selector and charts. */
function LifecycleAbout() {
  const { displayable } = useMeasureCatalogue();
  return (
    <div className="methodology-content lifecycle-about">
      <p className="method-lead">
        Estimates the lifetime change in take-home pay from selected published
        measures that the lifetime model can calculate, allowing for earnings
        growth, tax thresholds and student loan repayments. Measures without a
        matching model result are listed as not modelled. A total is available
        only when every selected measure is modelled.
      </p>
      <div className="about-columns">
        <div>
          <h4>Published measures</h4>
          {[
            ["Raise revenue", displayable.filter((measure) => measure.direction === "revenue")],
            ["Cost revenue", displayable.filter((measure) => measure.direction === "cost")],
            ["Other measures", displayable.filter((measure) => measure.direction === "neutral")],
          ].filter(([, items]) => items.length).map(([heading, items]) => (
            <div key={heading} className="about-group">
              <p className="about-group-heading">{heading}</p>
              <ul className="about-policies">
                {items.map((measure) => (
                  <li key={measure.id}>
                    <span className="about-swatch" style={{ background: measure.color }} aria-hidden="true" />
                    <span><strong>{measure.label}</strong>{measure.description ? `: ${measure.description}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h4>Assumptions</h4>
          <ul className="about-bullets">
            {ASSUMPTIONS.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="about-note">Positive values mean higher net income under the measures; negative values mean lower.</p>
    </div>
  );
}

export default LifecycleAbout;

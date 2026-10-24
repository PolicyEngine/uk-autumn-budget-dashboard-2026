import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { hasPersonalContract } from "../utils/personalSelection";
import "./LifecycleCalculator.css";

// The separate lifetime model keeps its existing assumptions. Published
// national descriptions do not establish that it implements those parameters.
const ASSUMPTIONS = [
  "The projection starts in 2026 at the age and salary entered, and runs to the life expectancy entered.",
  "Earnings follow an age profile that starts at 22: they rise to 2.2 times their level at 22 by 50, then stay there. A salary entered before 22 is held flat until 22.",
  "On top of that profile, earnings grow by 1% a year.",
  "After the retirement age entered, income is the State Pension.",
  "CPI and RPI follow the OBR forecast, then 2% and 2.39%.",
];

function LifecycleAbout() {
  const { displayable } = useMeasureCatalogue();
  const hasReviewedMappings = displayable.some((measure) => hasPersonalContract(measure, "lifecycle"));
  return (
    <div className="methodology-content lifecycle-about">
      <p className="method-lead">
        The lifetime calculator uses a separate, simpler model with its own
        policy values. Published measures are not modelled unless a reviewed
        mapping confirms their parameters and supported years. A total requires
        every selected measure to be modelled for every projected year.
        {!hasReviewedMappings && " No such mappings are published today, so their lifetime impacts and net total are unavailable."}
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
                    <span><strong>{measure.label}</strong>: {hasPersonalContract(measure, "lifecycle") ? measure.personal.description : "not modelled."}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h4>Assumptions</h4>
          <ul className="about-bullets">
            {ASSUMPTIONS.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
      </div>
      <p className="about-note">Positive values mean higher net income under the measures; negative values mean lower.</p>
    </div>
  );
}

export default LifecycleAbout;

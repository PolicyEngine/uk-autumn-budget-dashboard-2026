import { useMeasureCatalogue } from "../utils/measureCatalogue";
import "./LifecycleCalculator.css";

/** Public descriptions are shared with the measure selector and charts. */
function LifecycleAbout() {
  const { displayable } = useMeasureCatalogue();
  return (
    <div className="methodology-content lifecycle-about">
      <p>
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
            <li>Work starts at 22 on the chosen salary.</li>
            <li>Earnings rise with age to 2.2 times the starting salary by 50.</li>
            <li>CPI and RPI follow the OBR forecast, then 2% and 2.39%.</li>
          </ul>
        </div>
      </div>
      <p className="about-note">Positive values mean higher net income under the measures; negative values mean lower.</p>
    </div>
  );
}

export default LifecycleAbout;

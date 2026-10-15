import { OUTCOME_LABELS } from "../utils/geography/format";
import "./OutcomeToggle.css";

/** The outcomes, percentage first: it is the default view. */
const OPTIONS = ["relative_change", "average_change"];

/** Switches results by area between % of income and £ per household. */
function OutcomeToggle({ value, onChange, label = "Show the change as" }) {
  return (
    <div className="outcome-toggle" role="group" aria-label={label}>
      {OPTIONS.map((outcome) => (
        <button
          key={outcome}
          type="button"
          className={`outcome-toggle-button${value === outcome ? " active" : ""}`}
          aria-pressed={value === outcome}
          onClick={() => onChange(outcome)}
        >
          {OUTCOME_LABELS[outcome]}
        </button>
      ))}
    </div>
  );
}

export default OutcomeToggle;

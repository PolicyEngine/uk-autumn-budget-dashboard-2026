import { OUTCOME_LABELS } from "../utils/geography/format";
import PillSelect from "./PillSelect";

/** The outcomes, percentage first: it is the default view. */
const OPTIONS = ["relative_change", "average_change"];

/**
 * Switches results by area between % of income and £ per household: the
 * light in-card pill, like every other in-card switch. `labels` renames
 * the options (results by group are £ a year, not per household).
 */
function OutcomeToggle({
  value,
  onChange,
  label = "Show the change as",
  labels = OUTCOME_LABELS,
}) {
  return (
    <PillSelect
      variant="light"
      name={label}
      prefix="Show as"
      value={value}
      onChange={onChange}
      options={OPTIONS.map((outcome) => ({
        value: outcome,
        label: labels[outcome],
      }))}
    />
  );
}

export default OutcomeToggle;

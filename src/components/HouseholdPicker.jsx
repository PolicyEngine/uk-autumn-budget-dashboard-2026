import PillSelect from "./PillSelect";
import { EXAMPLE_HOUSEHOLDS, exampleHousehold } from "../utils/exampleHouseholds";
import "./HouseholdPicker.css";

/**
 * Chooses the example household a card shows, with its one-line definition
 * underneath: the light in-card pill, like every other in-card switch.
 */
function HouseholdPicker({ value, onChange }) {
  const household = exampleHousehold(value);
  return (
    <div className="chart-controls household-picker">
      <PillSelect
        variant="light"
        name="Example household"
        prefix="Household"
        value={household.id}
        onChange={onChange}
        options={EXAMPLE_HOUSEHOLDS.map((option) => ({
          value: option.id,
          label: option.label,
        }))}
      />
      <p className="household-definition">{household.definition}</p>
    </div>
  );
}

export default HouseholdPicker;

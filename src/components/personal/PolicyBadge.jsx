import Tip from "../Tip";
import { MeasureIcon } from "../MeasureRowLabel";
import "./PolicyBadge.css";

/** A measure's full published name (its short name is for tight labels). */
const fullName = (measure) => measure?.label ?? measure?.name ?? measure?.id;

/**
 * The policies a group of questions is asked for, as a row of tiny muted
 * icons (each measure's category icon) at the end of the group's heading,
 * their names in a tooltip on hover or tap and in the accessible name. Not a
 * control (no tab stop) and no tick.
 */
export default function PolicyIcons({ measures }) {
  if (!measures.length) return null;
  const names = measures.map(fullName);
  return (
    <Tip content={names.join(" · ")}>
      <span className="policy-icons" role="img" aria-label={`Used by ${names.join(", ")}`}>
        {measures.map((measure, index) => (
          <MeasureIcon key={measure.id ?? index} measure={measure} compact />
        ))}
      </span>
    </Tip>
  );
}

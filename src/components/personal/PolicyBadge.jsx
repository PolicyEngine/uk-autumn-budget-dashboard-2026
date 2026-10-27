import { MeasureIcon } from "../MeasureRowLabel";
import { shortNameOf } from "../../utils/policyDetails";
import "./PolicyBadge.css";

/**
 * A small chip naming a policy: its category icon in its colour and its
 * short name, the full name for screen readers. Not a control (no tab stop,
 * no tooltip) and no tick: it only says which policy something is for.
 */
export function PolicyBadge({ measure }) {
  const short = shortNameOf(measure);
  const full = measure?.label ?? measure?.name ?? short;
  return (
    <span className="policy-badge" style={measure?.color ? { "--mrl-colour": measure.color } : undefined}>
      <MeasureIcon measure={measure} compact />
      <span className="policy-badge-name" aria-hidden={full !== short || undefined}>
        {short}
      </span>
      {full !== short && <span className="visually-hidden">{full}</span>}
    </span>
  );
}

/**
 * The policies a question is asked for, as a row of badges. `id` lets the
 * question's box name it (aria-describedby).
 */
export default function PolicyBadges({ measures, id, label = "For" }) {
  if (!measures.length) return null;
  return (
    <span className="policy-badges" id={id}>
      <span className="visually-hidden">{label}: </span>
      {measures.map((measure, index) => (
        <span key={measure.id ?? index} className="policy-badges-item">
          <PolicyBadge measure={measure} />
          {index < measures.length - 1 && <span className="visually-hidden">, </span>}
        </span>
      ))}
    </span>
  );
}

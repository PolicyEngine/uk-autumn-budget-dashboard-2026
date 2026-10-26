import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import "./ModellingFacts.css";

/** "1 known limitation", "2 known limitations", or nothing. */
export function limitationCount(limits) {
  if (!limits.length) return null;
  return `${limits.length} known ${limits.length === 1 ? "limitation" : "limitations"}`;
}

/**
 * A measure's modelling, read from its published wording: fact chips
 * (Day-weighted, Wages held fixed and so on), limitation chips that open
 * to the sentence stating the limit, and any modelling note as bullets. A
 * limitation whose sentence the card already shows is a plain chip, so no
 * sentence is said twice.
 *
 * @param {Object} props
 * @param {{facts: string[], limits: {label: string, sentence: string}[], notePoints: string[]}} props.modelling
 * @param {string} [props.shown] - Text the card already shows
 */
function ModellingFacts({ modelling, shown = "" }) {
  const [open, setOpen] = useState([]);
  const id = useId();
  const { facts, limits, notePoints } = modelling;
  const toggle = (index) =>
    setOpen((current) => (current.includes(index) ? current.filter((value) => value !== index) : [...current, index]));
  if (!facts.length && !limits.length && !notePoints.length) return null;
  return (
    <div className="mf">
      {(facts.length > 0 || limits.length > 0) && (
        <div className="mf-chips">
          {facts.map((fact) => (
            <span key={fact} className="mf-chip">
              {fact}
            </span>
          ))}
          {limits.map((limit, index) =>
            shown.includes(limit.sentence) ? (
              <span key={limit.sentence} className="mf-chip mf-chip-limit">
                <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
                {limit.label}
              </span>
            ) : (
              <button
                key={limit.sentence}
                type="button"
                className="mf-chip mf-chip-limit"
                aria-expanded={open.includes(index)}
                aria-controls={`${id}-limit-${index}`}
                onClick={() => toggle(index)}
              >
                <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
                {limit.label}
              </button>
            ),
          )}
        </div>
      )}
      {limits.map((limit, index) =>
        shown.includes(limit.sentence) ? null : (
          <p key={limit.sentence} id={`${id}-limit-${index}`} className="mf-limit" hidden={!open.includes(index)}>
            {limit.sentence}
          </p>
        ),
      )}
      {notePoints.length > 0 && (
        <ul className="mf-note" aria-label="Modelling note">
          {notePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ModellingFacts;

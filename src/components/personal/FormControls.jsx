import { useId, useState } from "react";

/**
 * One choice from a few, as selectable boxes: native radio buttons styled
 * as tiles, so the group has radio semantics, arrow keys move between the
 * options and Tab enters and leaves the group.
 *
 * @param {Object} props
 * @param {string} props.id - The field's id (the radios' name)
 * @param {string} props.label - The question
 * @param {Array<{value: string|number|boolean, label: string, hint?: string}>} props.options
 * @param {*} props.value - The chosen option's value
 * @param {(value: *) => void} props.onChange
 * @param {string} [props.hint] - A line under the boxes
 * @param {"wide"|"compact"|"grid"} [props.layout] - wide: two to five boxes
 *   that share the row; compact: short labels (A to H, 0 to 6); grid: many
 *   boxes that wrap (regions)
 */
export function ChoiceTiles({ id, label, options, value, onChange, hint, layout = "wide" }) {
  const uid = useId();
  const legendId = `${uid}-legend`;
  const hintId = hint ? `hint-${id}` : undefined;
  return (
    <fieldset
      className={`choice-field choice-${layout}`}
      role="radiogroup"
      aria-labelledby={legendId}
      aria-describedby={hintId}
      data-field={id}
    >
      <legend id={legendId} className="field-label">
        {label}
      </legend>
      <div className="choice-tiles" style={{ "--choice-count": options.length }}>
        {options.map((option) => {
          const checked = option.value === value;
          const optionId = `${uid}-${String(option.value)}`;
          return (
            <label key={String(option.value)} className={`choice-tile ${checked ? "is-checked" : ""}`} htmlFor={optionId}>
              <input
                id={optionId}
                type="radio"
                name={`${uid}-${id}`}
                value={String(option.value)}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              <span className="choice-tile-label">{option.label}</span>
              {option.hint && <span className="choice-tile-hint">{option.hint}</span>}
            </label>
          );
        })}
      </div>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * A number with − and + steppers. The box takes any value in range as
 * typed; the steppers move by `step`. Amounts show a £ prefix.
 *
 * @param {Object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {number} props.value
 * @param {(value: number) => void} props.onChange
 * @param {number} props.min
 * @param {number} props.max
 * @param {number} props.step
 * @param {boolean} [props.money] - Show £ before the number
 * @param {string} [props.suffix] - A unit after the number ("a month")
 * @param {string} [props.hint]
 * @param {string} [props.inputLabel] - The box's accessible name, when it differs from the visible label
 * @param {string} [props.outOfRangeMessage] - Said while the typed value is
 *   outside min to max, and after leaving the box moved it into range, so a
 *   value is never changed without a word
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  money = false,
  suffix,
  hint,
  inputLabel,
  outOfRangeMessage,
}) {
  const hintId = hint ? `hint-${id}` : undefined;
  const fieldId = `field-${id}`;
  const shown = Number.isFinite(value) ? value : min;
  // The value typed before leaving the box moved it into range
  const [clampedFrom, setClampedFrom] = useState(null);
  const stepTo = (direction) => {
    // Snap to the step grid, then move one step
    const base = direction > 0 ? Math.floor(shown / step) * step : Math.ceil(shown / step) * step;
    const next = base === shown ? shown + direction * step : direction > 0 ? base + step : base - step;
    setClampedFrom(null);
    onChange(clamp(next, min, max));
  };
  // What is typed, kept while it is out of range or empty; a value in
  // range goes straight to the form, and leaving the box snaps into range
  const [draft, setDraft] = useState(String(shown));
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    // The value changed from outside (a stepper, an example): show it
    setSynced(shown);
    if (parseFloat(draft) !== shown) setDraft(String(shown));
  }
  const name = inputLabel ?? label;
  return (
    <div className="number-field" data-field={id}>
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="number-stepper">
        <button
          type="button"
          className="stepper-button"
          aria-label={`${name}: ${money ? "£" : ""}${step.toLocaleString("en-GB")} less`}
          disabled={shown <= min}
          onClick={() => stepTo(-1)}
        >
          −
        </button>
        <div className={`number-box ${money ? "is-money" : ""}`}>
          {money && (
            <span className="number-prefix" aria-hidden="true">
              £
            </span>
          )}
          <input
            id={fieldId}
            type="number"
            inputMode="numeric"
            value={draft}
            min={min}
            max={max}
            step={step}
            aria-label={inputLabel}
            aria-describedby={hintId}
            onChange={(event) => {
              setDraft(event.target.value);
              setClampedFrom(null);
              const parsed = parseFloat(event.target.value);
              if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
            }}
            onBlur={() => {
              const parsed = parseFloat(draft);
              const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : shown;
              if (Number.isFinite(parsed) && next !== parsed) setClampedFrom(parsed);
              setDraft(String(next));
              if (next !== shown) onChange(next);
            }}
          />
        </div>
        <button
          type="button"
          className="stepper-button"
          aria-label={`${name}: ${money ? "£" : ""}${step.toLocaleString("en-GB")} more`}
          disabled={shown >= max}
          onClick={() => stepTo(1)}
        >
          +
        </button>
        {suffix && <span className="number-suffix">{suffix}</span>}
      </div>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {outOfRangeMessage && (outOfRange(draft, min, max) || clampedFrom !== null) && (
        <p className="field-error" role="alert">
          {outOfRangeMessage}
          {clampedFrom !== null && !outOfRange(draft, min, max)
            ? ` ${clampedFrom.toLocaleString("en-GB")} was changed to ${shown.toLocaleString("en-GB")}.`
            : ""}
        </p>
      )}
    </div>
  );
}

/** Whether typed text is a number outside min to max. */
function outOfRange(text, min, max) {
  const parsed = parseFloat(text);
  return Number.isFinite(parsed) && (parsed < min || parsed > max);
}

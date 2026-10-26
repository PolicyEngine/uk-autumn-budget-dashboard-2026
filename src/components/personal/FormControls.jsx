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
 * @param {boolean} [props.hideLabel] - Keep the question for screen readers
 *   only (a row above already shows it)
 * @param {"wide"|"compact"|"grid"} [props.layout] - wide: two to five boxes
 *   that share the row; compact: short labels (A to H, 0 to 6); grid: many
 *   boxes that wrap (regions)
 */
export function ChoiceTiles({ id, label, options, value, onChange, hint, layout = "wide", hideLabel = false }) {
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
      <legend id={legendId} className={hideLabel ? "visually-hidden" : "field-label"}>
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

/**
 * A field's label and its hint. A short hint goes under the box; a long one
 * (`hintAs="tooltip"`) sits behind an "i" beside the label, shown on hover
 * or focus, and is still the box's description for screen readers.
 */
export function FieldLabel({ htmlFor, label, hint, hintId, hintAs, hidden }) {
  if (hidden) {
    return (
      <label className="visually-hidden" htmlFor={htmlFor}>
        {label}
      </label>
    );
  }
  if (!hint || hintAs !== "tooltip") {
    return (
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
    );
  }
  return (
    <div className="label-with-info">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <span className="info-icon-wrapper">
        <button type="button" className="info-icon" aria-label={`About ${label}`} aria-describedby={hintId}>
          i
        </button>
        <span className="info-tooltip" role="tooltip" id={hintId}>
          {hint}
        </span>
      </span>
    </div>
  );
}

/** A hint under the box, unless it is in the label's tooltip. */
export function FieldHint({ hint, hintId, hintAs }) {
  if (!hint || hintAs === "tooltip") return null;
  return (
    <p className="field-hint" id={hintId}>
      {hint}
    </p>
  );
}

/**
 * One choice from a list, as a native select with its label above and a
 * hint below. Options may hold strings, numbers or booleans: the select
 * keeps each option's index and gives back its value.
 *
 * @param {Object} props
 * @param {string} props.id - The field's id
 * @param {string} props.label
 * @param {Array<{value: string|number|boolean, label: string}>} props.options
 * @param {*} props.value - The chosen option's value
 * @param {(value: *) => void} props.onChange
 * @param {string} [props.hint] - A line under the box
 * @param {"below"|"tooltip"} [props.hintAs] - Where the hint goes
 */
export function SelectField({ id, label, options, value, onChange, hint, hintAs = "below" }) {
  const fieldId = `field-${id}`;
  const hintId = hint ? `hint-${id}` : undefined;
  const index = options.findIndex((option) => option.value === value);
  return (
    <div className="select-field" data-field={id}>
      <FieldLabel htmlFor={fieldId} label={label} hint={hint} hintId={hintId} hintAs={hintAs} />
      <div className="select-box">
        <select
          id={fieldId}
          value={String(index)}
          aria-describedby={hintId}
          onChange={(event) => onChange(options[Number(event.target.value)].value)}
        >
          {options.map((option, i) => (
            <option key={String(option.value)} value={String(i)}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <FieldHint hint={hint} hintId={hintId} hintAs={hintAs} />
    </div>
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
 * @param {"below"|"tooltip"} [props.hintAs] - Where the hint goes
 * @param {string} [props.inputLabel] - The box's accessible name, when it differs from the visible label
 * @param {boolean} [props.hideLabel] - Keep the label for screen readers
 *   only (a row above already shows it)
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
  hintAs = "below",
  inputLabel,
  outOfRangeMessage,
  hideLabel = false,
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
      <FieldLabel htmlFor={fieldId} label={label} hint={hint} hintId={hintId} hintAs={hintAs} hidden={hideLabel} />
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
      <FieldHint hint={hint} hintId={hintId} hintAs={hintAs} />
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

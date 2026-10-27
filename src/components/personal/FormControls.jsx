import { useId, useState } from "react";
import { InfoTip } from "../Tip";

/** Element ids for aria-describedby, the empty ones left out (undefined if none). */
const joinIds = (...ids) => ids.filter(Boolean).join(" ") || undefined;

/**
 * One choice from a few, as selectable boxes: native radio buttons styled
 * as tiles (or, `layout="segmented"`, one joined row of them), so the group
 * has radio semantics, arrow keys move between the options and Tab enters
 * and leaves the group.
 *
 * @param {Object} props
 * @param {string} props.id - The field's id (the radios' name)
 * @param {string} props.label - The question
 * @param {Array<{value: string|number|boolean, label: string, hint?: string}>} props.options
 * @param {*} props.value - The chosen option's value
 * @param {(value: *) => void} props.onChange
 * @param {string} [props.hint] - A line under the boxes, or behind the info icon
 * @param {"below"|"tooltip"} [props.hintAs] - Where the hint goes
 * @param {boolean} [props.hideLabel] - Keep the question for screen readers
 *   only (a row above already shows it)
 * @param {"wide"|"compact"|"grid"|"segmented"} [props.layout] - wide: two to
 *   five boxes that share the row; compact: short labels (A to H, 0 to 6);
 *   grid: many boxes that wrap (regions); segmented: one joined row
 */
export function ChoiceTiles({ id, label, options, value, onChange, hint, hintAs = "below", layout = "wide", hideLabel = false, describedBy }) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = hint ? `hint-${id}` : undefined;
  const description = joinIds(hintId, describedBy);
  return (
    <div
      className={`choice-field choice-${layout}`}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={description}
      data-field={id}
    >
      {hideLabel ? (
        <span id={labelId} className="visually-hidden">
          {label}
        </span>
      ) : (
        <div className="label-with-info">
          <span id={labelId} className="field-label">
            {label}
          </span>
          {hint && hintAs === "tooltip" && <InfoTip content={hint} label={`About ${label}`} />}
        </div>
      )}
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
      {hint && hintAs !== "tooltip" && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {hint && hintAs === "tooltip" && <HiddenHint hint={hint} hintId={hintId} />}
    </div>
  );
}

/**
 * A hint shown behind the label's info icon (InfoTip, whose tip renders
 * only while open): kept in the page, hidden, as the field's description
 * for screen readers.
 */
function HiddenHint({ hint, hintId }) {
  return (
    <span className="visually-hidden" id={hintId}>
      {hint}
    </span>
  );
}

/**
 * A field's label and its hint. A short hint goes under the box; a long one
 * (`hintAs="tooltip"`) sits behind the info icon beside the label (the
 * shared InfoTip), shown on hover, focus or a tap, and is still the box's
 * description for screen readers.
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
      <InfoTip content={hint} label={`About ${label}`} />
      <HiddenHint hint={hint} hintId={hintId} />
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
export function SelectField({ id, label, options, value, onChange, hint, hintAs = "below", describedBy }) {
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
          aria-describedby={joinIds(hintId, describedBy)}
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
 * An amount as typed: "34200", "34,200", "£34,200", "34k" or "1.2m".
 * NaN when it is not a number.
 */
export function parseAmount(text) {
  const match = String(text)
    .trim()
    .toLowerCase()
    .replace(/[£,\s]/g, "")
    .match(/^(-?\d*\.?\d+)([km])?$/);
  if (!match) return NaN;
  return parseFloat(match[1]) * (match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : 1);
}

const formatAmount = (value) => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/**
 * A number. Ages and counts have − and + steppers that move by `step`;
 * amounts (`money`) are a plain box with £ before them, their unit after,
 * and thousands separators once you leave the box ("34k" is taken too).
 * The box takes any value in range as typed.
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
 * @param {boolean} [props.stepper] - Show − and +; by default only for
 *   numbers that are not amounts
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
  stepper = !money,
  suffix,
  hint,
  hintAs = "below",
  inputLabel,
  outOfRangeMessage,
  hideLabel = false,
  describedBy: extraDescribedBy,
}) {
  const hintId = hint ? `hint-${id}` : undefined;
  const fieldId = `field-${id}`;
  const shown = Number.isFinite(value) ? value : min;
  const parse = money ? parseAmount : parseFloat;
  // The value typed before leaving the box moved it into range
  const [clampedFrom, setClampedFrom] = useState(null);
  // An amount shows its thousands separators except while it is edited
  const [editing, setEditing] = useState(false);
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
    if (parse(draft) !== shown) setDraft(String(shown));
  }
  const name = inputLabel ?? label;
  // The message under the box, tied to it (aria-describedby) and the box
  // marked invalid while the typed value is out of range (WCAG 3.3.1)
  const invalid = Boolean(outOfRangeMessage) && outOfRange(parse(draft), min, max);
  const errorShown = Boolean(outOfRangeMessage) && (invalid || clampedFrom !== null);
  const errorId = `error-${id}`;
  const describedBy = joinIds(hintId, errorShown ? errorId : null, extraDescribedBy);
  const typed = parse(draft);
  const boxValue = money && !editing && Number.isFinite(typed) ? formatAmount(typed) : draft;
  const stepButton = (direction) => (
    <button
      type="button"
      className="stepper-button"
      aria-label={`${name}: ${money ? "£" : ""}${step.toLocaleString("en-GB")} ${direction > 0 ? "more" : "less"}`}
      disabled={direction > 0 ? shown >= max : shown <= min}
      onClick={() => stepTo(direction)}
    >
      {direction > 0 ? "+" : "−"}
    </button>
  );
  return (
    <div className={`number-field ${money ? "is-money" : ""}`} data-field={id}>
      <FieldLabel htmlFor={fieldId} label={label} hint={hint} hintId={hintId} hintAs={hintAs} hidden={hideLabel} />
      <div className={`number-stepper ${stepper ? "" : "no-steppers"}`.trim()}>
        {stepper && stepButton(-1)}
        <div className={`number-box ${money ? "is-money" : ""}`}>
          {money && (
            <span className="number-prefix" aria-hidden="true">
              £
            </span>
          )}
          <input
            id={fieldId}
            // Amounts are text, so they can show "34,200"; numeric keypad
            // on phones either way
            type={money ? "text" : "number"}
            inputMode={money ? "decimal" : "numeric"}
            autoComplete="off"
            value={boxValue}
            min={money ? undefined : min}
            max={money ? undefined : max}
            step={money ? undefined : step}
            aria-label={inputLabel}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onFocus={() => setEditing(true)}
            onChange={(event) => {
              setDraft(event.target.value);
              setClampedFrom(null);
              const parsed = parse(event.target.value);
              if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
            }}
            onBlur={() => {
              setEditing(false);
              const parsed = parse(draft);
              const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : shown;
              if (Number.isFinite(parsed) && next !== parsed) setClampedFrom(parsed);
              setDraft(String(next));
              if (next !== shown) onChange(next);
            }}
          />
        </div>
        {stepper && stepButton(1)}
        {suffix && <span className="number-suffix">{suffix}</span>}
      </div>
      <FieldHint hint={hint} hintId={hintId} hintAs={hintAs} />
      {errorShown && (
        <p className="field-error" id={errorId} role="alert">
          {outOfRangeMessage}
          {clampedFrom !== null && !outOfRange(parse(draft), min, max)
            ? ` ${clampedFrom.toLocaleString("en-GB")} was changed to ${shown.toLocaleString("en-GB")}.`
            : ""}
        </p>
      )}
    </div>
  );
}

/** Whether a typed number is outside min to max. */
function outOfRange(parsed, min, max) {
  return Number.isFinite(parsed) && (parsed < min || parsed > max);
}

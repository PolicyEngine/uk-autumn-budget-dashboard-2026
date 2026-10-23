import { useEffect, useId, useRef, useState } from "react";
import "./PillSelect.css";

/**
 * A pill that opens a short list of options: [badge] label ▼.
 *
 * The badge shows the chosen option; the list marks it with a check. The
 * band variant matches the year and policy pills in the title band (it
 * shares .policy-selector-toggle); the light variant is the in-card
 * version. Button + listbox: arrow keys move, Enter or a click chooses,
 * Escape or a click outside closes, and focus returns to the button.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string, badge?: string, suffix?: string, disabled?: boolean, title?: string}>} props.options
 *   - `suffix` replaces `label` after this option's badge ("" for none);
 *   a disabled option is listed (with `title` saying why) but cannot be
 *   chosen
 * @param {string} props.value - The chosen option's value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.name - What is being chosen, for the accessible name
 * @param {string} [props.label] - Text after the badge (e.g. "impact")
 * @param {string} [props.prefix] - Muted text before the badge (light variant)
 * @param {"band"|"light"} [props.variant]
 * @param {boolean} [props.stableWidth] - Keep the pill as wide as its widest
 *   option, so choosing another option never moves what is beside it
 */
function PillSelect({
  options,
  value,
  onChange,
  name,
  label,
  prefix,
  variant = "band",
  stableWidth = false,
}) {
  const [open, setOpen] = useState(false);
  const current = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [active, setActive] = useState(current);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choose = (index) => {
    if (options[index].disabled) return;
    onChange(options[index].value);
    close();
  };

  const onKeyDown = (event) => {
    const last = options.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(last, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const chosen = options[current];
  const optionId = (index) => `${listId}-option-${index}`;
  const suffixOf = (option) => option.suffix ?? label;
  const face = (option) => (
    <>
      <span className="policy-selector-count pill-select-badge">
        {option.badge ?? option.label}
      </span>
      {suffixOf(option) && <span className="policy-selector-label">{suffixOf(option)}</span>}
    </>
  );

  return (
    <div className={`pill-select pill-select-${variant}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={
          variant === "band"
            ? "policy-selector-toggle pill-select-toggle"
            : "pill-select-toggle"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${name}: ${chosen.label}`}
        title={stableWidth ? chosen.label : undefined}
        onClick={() => {
          setActive(current);
          setOpen((isOpen) => !isOpen);
        }}
      >
        {prefix && <span className="pill-select-prefix">{prefix}</span>}
        {stableWidth ? (
          // Every option's face in one grid cell; only the chosen one shows
          <span className="pill-select-faces">
            {options.map((option, index) => (
              <span
                key={option.value}
                className={`pill-select-face ${index === current ? "is-chosen" : ""}`}
                aria-hidden={index === current ? undefined : "true"}
              >
                {face(option)}
              </span>
            ))}
          </span>
        ) : (
          face(chosen)
        )}
        <span className="policy-selector-icon" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="pill-select-list"
          role="listbox"
          aria-label={name}
          tabIndex={-1}
          aria-activedescendant={optionId(active)}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              aria-disabled={option.disabled ? "true" : undefined}
              title={option.title}
              className={`pill-select-option ${index === active ? "is-active" : ""} ${
                option.disabled ? "is-disabled" : ""
              }`}
              onClick={() => choose(index)}
              onMouseEnter={() => setActive(index)}
            >
              <span className="pill-select-check" aria-hidden="true">
                {index === current ? "✓" : ""}
              </span>
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PillSelect;

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CONSTITUENCIES, exactConstituency, searchConstituencies } from "../../utils/constituencies";
import { FieldLabel } from "./FormControls";
import "./ConstituencyField.css";

/**
 * A constituency, picked by typing part of its name: an editable combobox
 * with a list of the matching constituencies (the ARIA 1.2 combobox
 * pattern). Arrow keys move through the list, Enter picks, Escape closes;
 * leaving the box keeps a name typed in full and otherwise goes back to the
 * constituency picked before. The region the picked constituency lies in
 * shows under the box: it is what the household calculation reads.
 *
 * @param {Object} props
 * @param {string} props.id - The field's id
 * @param {string} props.label
 * @param {string|null} props.value - The picked constituency's name, or null
 * @param {string} props.regionLabel - The region in use, as shown ("North West")
 * @param {(seat: {name: string, region: string}) => void} props.onChange
 * @param {string} [props.hint] - A note behind the "i" by the label
 */
export default function ConstituencyField({ id, label, value, regionLabel, onChange, hint }) {
  const uid = useId();
  const fieldId = `field-${id}`;
  const listId = `${uid}-list`;
  const hintId = hint ? `hint-${id}` : undefined;
  const regionId = `region-${id}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const [active, setActive] = useState(-1);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // The query as typed; the picked name alone lists every constituency, so
  // reopening the list shows the others
  const matches = useMemo(
    () => (query === (value ?? "") ? CONSTITUENCIES : searchConstituencies(query)),
    [query, value],
  );

  // Keep the box in step with a value set from outside (an example)
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setQuery(value ?? "");
  }

  // The active option stays in view as the arrow keys move it
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    const at = matches.findIndex((seat) => seat.name === value);
    setActive(at);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (seat) => {
    setQuery(seat.name);
    close();
    if (seat.name !== value) onChange(seat);
  };
  // Leaving the box: a full name typed is picked; anything else goes back
  const settle = () => {
    const typed = exactConstituency(query);
    if (typed) pick(typed);
    else {
      setQuery(value ?? "");
      close();
    }
  };

  const onKeyDown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openList();
        else setActive((index) => Math.min(matches.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else setActive((index) => Math.max(0, index - 1));
        break;
      case "Enter":
        if (open && matches[active]) {
          event.preventDefault();
          pick(matches[active]);
        } else if (open && matches.length === 1) {
          event.preventDefault();
          pick(matches[0]);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          setQuery(value ?? "");
          close();
        }
        break;
      default:
    }
  };

  const describedBy = [regionId, hintId].filter(Boolean).join(" ");
  const activeId = open && active >= 0 && matches[active] ? `${uid}-option-${active}` : undefined;
  return (
    <div className={`constituency-field ${open ? "is-open" : ""}`.trim()} data-field={id}>
      <FieldLabel htmlFor={fieldId} label={label} hint={hint} hintId={hintId} hintAs="tooltip" />
      <div className="constituency-box">
        <svg
          className="constituency-search-icon"
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
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={`Search ${CONSTITUENCIES.length} constituencies`}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-describedby={describedBy}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onClick={openList}
          onFocus={(event) => event.target.select()}
          onBlur={settle}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="constituency-toggle"
          tabIndex={-1}
          aria-label={open ? "Close the list" : "Show the list"}
          aria-controls={listId}
          aria-expanded={open}
          // Keep the box focused, so its blur does not close the list first
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              inputRef.current?.focus();
              openList();
            }
          }}
        >
          <svg
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
        </button>
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={`${label}s`}
          className="constituency-list"
          hidden={!open}
        >
          {open &&
            matches.map((seat, index) => (
              <li
                key={seat.name}
                id={`${uid}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`constituency-option ${index === active ? "is-active" : ""} ${
                  seat.name === value ? "is-picked" : ""
                }`.trim()}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => pick(seat)}
              >
                {seat.name}
              </li>
            ))}
          {open && matches.length === 0 && (
            <li className="constituency-empty" role="presentation">
              No constituency matches
            </li>
          )}
        </ul>
      </div>
      <p className="field-hint constituency-region" id={regionId}>
        {value ? regionLabel : `${regionLabel}, until you pick a constituency`}
      </p>
      <span className="visually-hidden" aria-live="polite">
        {open ? `${matches.length} ${matches.length === 1 ? "constituency" : "constituencies"}` : ""}
      </span>
    </div>
  );
}

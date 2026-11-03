import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LOCAL_AUTHORITIES, exactLocalAuthority, searchLocalAuthorities } from "../../utils/localAuthorities";
import { FieldLabel } from "./FormControls";
import "./LocalAuthorityField.css";

/**
 * A local authority (council), picked by typing part of its name: an editable combobox
 * with a list of the matching local authorities (the ARIA 1.2 combobox
 * pattern). Arrow keys move through the list, Enter picks, Escape closes;
 * leaving the box keeps a name typed in full and otherwise goes back to the
 * council picked before. The region the picked council lies in
 * shows under the box: it is what the household calculation reads.
 *
 * @param {Object} props
 * @param {string} props.id - The field's id
 * @param {string} props.label
 * @param {string|null} props.value - The picked local authority's name, or null
 * @param {string} props.regionLabel - The region in use, as shown ("North West")
 * @param {(council: {name: string, key: string, region: string}) => void} props.onChange
 * @param {string} [props.hint] - A note behind the info icon by the label
 */
export default function LocalAuthorityField({ id, label, value, regionLabel, onChange, hint }) {
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

  // The query as typed; the picked name alone lists every local authority, so
  // reopening the list shows the others
  const matches = useMemo(
    () => (query === (value ?? "") ? LOCAL_AUTHORITIES : searchLocalAuthorities(query)),
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
    const at = matches.findIndex((council) => council.name === value);
    setActive(at);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (council) => {
    setQuery(council.name);
    close();
    if (council.name !== value) onChange(council);
  };
  // Leaving the box: a full name typed is picked; anything else goes back
  const settle = () => {
    const typed = exactLocalAuthority(query);
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
    <div className={`council-field ${open ? "is-open" : ""}`.trim()} data-field={id}>
      <FieldLabel htmlFor={fieldId} label={label} hint={hint} hintId={hintId} hintAs="tooltip" />
      <div className="council-box">
        <svg
          className="council-search-icon"
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
          placeholder={`Search ${LOCAL_AUTHORITIES.length} local authorities`}
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
          className="council-toggle"
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
          aria-label="Local authorities"
          className="council-list"
          hidden={!open}
        >
          {open &&
            matches.map((council, index) => (
              <li
                key={council.name}
                id={`${uid}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`council-option ${index === active ? "is-active" : ""} ${
                  council.name === value ? "is-picked" : ""
                }`.trim()}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => pick(council)}
              >
                {council.name}
              </li>
            ))}
          {open && matches.length === 0 && (
            <li className="council-empty" role="presentation">
              No local authority matches
            </li>
          )}
        </ul>
      </div>
      <p className="field-hint council-region" id={regionId}>
        {value ? regionLabel : `${regionLabel}, until you pick your council`}
      </p>
      <span className="visually-hidden" aria-live="polite">
        {open ? `${matches.length} ${matches.length === 1 ? "local authority" : "local authorities"}` : ""}
      </span>
    </div>
  );
}

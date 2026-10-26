import { useEffect, useId, useRef, useState } from "react";
import usePresence, { leavingProps, popoverClass } from "../hooks/usePresence";
import useSegmentThumb from "../hooks/useSegmentThumb";
import PillChevron from "./PillChevron";
import "./ControlBar.css";

/**
 * A card's controls on one row: at most two primary pills (the view, the
 * years), then one "Options" button whose face sums up every other choice
 * ("Median · Before housing costs · Real · Both"). The button opens a small
 * dialog with those choices as segmented toggles; on a phone it is a sheet
 * from the bottom of the screen. The summary changes with the choices, so
 * the state stays in view without a pill for each.
 *
 * Each option group calls the same setter its pill did, so what is kept in
 * the address is unchanged.
 *
 * @param {Object} props
 * @param {React.ReactNode} [props.children] - The primary pills
 * @param {Array<{label: string, value: string, onChange: (value: string) => void,
 *   options: Array<{value: string, label: string, badge?: string, disabled?: boolean, title?: string}>}
 *   | {label: string, summary: string, control: React.ReactNode}>} [props.options] - A
 *   group with `control` shows that control in place of segments (the years compared)
 * @param {string} [props.name] - What the options are for, for the dialog's name
 */
export default function ControlBar({ children, options = [], name = "Chart" }) {
  const groups = options.filter(Boolean);
  return (
    <div className="control-bar">
      {children}
      {groups.length > 0 && <OptionsButton groups={groups} name={name} />}
    </div>
  );
}

/**
 * The pill's label: every group's current choice, in the dialog's order,
 * so it cannot drift from what the dialog holds. A show/hide group
 * (`omitAtDefault`: its default value) is left out while at that default.
 */
const inSummary = (group) => !("omitAtDefault" in group) || group.value !== group.omitAtDefault;

export function optionsSummary(groups) {
  return groups
    .filter(Boolean)
    .filter(inSummary)
    .map(chosenText)
    .filter(Boolean)
    .join(" · ");
}

/** The short form of a group's chosen option, for the summary. */
function chosenText(group) {
  // A group with its own control (the years compared) gives its summary
  if (group.control) return group.summary ?? "";
  const option = group.options.find((candidate) => candidate.value === group.value) ?? group.options[0];
  return option?.summary ?? option?.label ?? "";
}

function OptionsButton({ groups, name }) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogId = useId();
  const titleId = useId();
  const summary = optionsSummary(groups);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // A click outside closes it (the backdrop on a phone is outside too)
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
      else if (event.target.classList?.contains("control-bar-backdrop")) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Focus moves into the dialog, to the first group's chosen option
  useEffect(() => {
    if (!open) return;
    const first = dialogRef.current?.querySelector('[role="radio"][aria-checked="true"]:not(:disabled)')
      ?? dialogRef.current?.querySelector("button:not(:disabled)");
    first?.focus();
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Focus stays in the dialog while it is open
    const focusable = [...dialogRef.current.querySelectorAll("button:not(:disabled)")].filter(
      (node) => node.tabIndex !== -1,
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="control-bar-options" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="control-bar-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Options: ${summary}`}
        title={summary}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <svg className="control-bar-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        <span className="control-bar-summary">{summary}</span>
        <PillChevron />
      </button>
      {presence.mounted && (
        <>
          {open && <div className="control-bar-backdrop" aria-hidden="true" />}
          <div
            ref={dialogRef}
            id={dialogId}
            {...leavingProps(presence.shown)}
            className={`control-bar-dialog ${popoverClass(presence.shown)}`}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
          >
            <div className="control-bar-dialog-head">
              <p id={titleId} className="control-bar-dialog-title">
                {name} options
              </p>
              <button type="button" className="control-bar-done" onClick={() => close()}>
                Done
              </button>
            </div>
            {groups.map((group) => (
              group.control ? <CustomGroup key={group.label} group={group} /> : <Segmented key={group.label} group={group} inSummary={inSummary(group)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A choice with its own control (two year lists), labelled as the others. */
function CustomGroup({ group }) {
  const labelId = useId();
  return (
    <div className="control-bar-group" role="group" aria-labelledby={labelId} data-summary={group.summary ?? ""}>
      <span id={labelId} className="control-bar-group-label">
        {group.label}
      </span>
      {group.control}
    </div>
  );
}

/**
 * One choice as a segmented toggle: a radio group whose options sit side
 * by side; the arrow keys move between them and choose, as radios do.
 */
export function Segmented({ group, inSummary: summarised = true }) {
  const labelId = useId();
  const { containerRef: thumbContainer, itemRef: thumbItem, ready: thumbReady, thumbStyle } = useSegmentThumb(group.value);
  const enabled = group.options.filter((option) => !option.disabled);
  const move = (event, step) => {
    event.preventDefault();
    const index = enabled.findIndex((option) => option.value === group.value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    group.onChange(next.value);
    const radios = event.currentTarget.querySelectorAll('[role="radio"]');
    const target = [...radios].find((node) => node.dataset.value === next.value);
    // After the choice re-renders, focus follows it
    requestAnimationFrame(() => target?.focus());
  };
  return (
    // data-in-summary: whether the pill's label carries this choice
    <div className="control-bar-group" data-in-summary={summarised}>
      <span id={labelId} className="control-bar-group-label">
        {group.label}
      </span>
      <div
        ref={thumbContainer}
        className={`control-bar-segments${thumbReady ? " has-thumb" : ""}`}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
        }}
      >
        {/* The chosen option's white pill, which slides to a new choice */}
        <span className={`segment-thumb${thumbReady ? " is-ready" : ""}`} style={thumbStyle} aria-hidden="true" />
        {group.options.map((option) => {
          const checked = option.value === group.value;
          return (
            <button
              key={option.value}
              ref={thumbItem(option.value)}
              type="button"
              role="radio"
              data-value={option.value}
              data-summary={typeof (option.summary ?? option.label) === "string" ? option.summary ?? option.label : undefined}
              aria-checked={checked}
              // One tab stop per group: its chosen option
              tabIndex={checked ? 0 : -1}
              disabled={option.disabled}
              title={option.title}
              aria-label={option.ariaLabel}
              className={`control-bar-segment${checked ? " is-checked" : ""}`}
              onClick={() => group.onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

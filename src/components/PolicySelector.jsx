import { useState, useRef, useEffect } from "react";
import MeasureRowLabel from "./MeasureRowLabel";
import usePresence, { leavingProps, popoverClass } from "../hooks/usePresence";
import "./PolicySelector.css";
import { ListChecks } from "lucide-react";
import PillChevron from "./PillChevron";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { measureSummary, shortNameOf } from "../utils/policyDetails";
import Tip, { InfoTip } from "./Tip";

// The menu's order: measures that raise revenue, then those that cost it,
// then the rest, each in the catalogue's order. One flat list, not grouped
// by category: most categories hold a single measure, so headings would
// label one row each and double the list's height; each row's category
// caption already says what grouping would.
const DIRECTION_ORDER = ["revenue", "cost", "neutral"];

/**
 * The band's policies control: "Policies All 9 policies" or "Policies 3 of
 * 9 policies"; while the publication loads, "Policies" with no count; with
 * none published, "No policies yet", disabled, its reason in a Tip. Its
 * menu is one row per policy (checkbox, icon, short name over its category,
 * the one-line summary in an info tip at the right), one flat list in the
 * catalogue's revenue order, a chosen row tinted, with Select all, Clear and
 * Done in a footer that stays in view. Up and down arrows (Home, End) move
 * between rows, space ticks, Escape closes. On a phone it is a sheet from
 * the foot of the screen.
 *
 * @param {Object} props
 * @param {boolean} [props.loading] - The publication is still loading
 * @param {string} [props.noneReason] - Why none are published, if none are
 * @param {string} [props.inactiveReason] - Why the policies do not change the
 *   view shown: the pill stays in place, faded, does not open; the reason
 *   is in its accessible name only (no visible tip)
 * @param {(ids: string[]) => void} [props.onPoliciesSet] - Sets the whole
 *   selection at once (Select all, Clear). One call, never a run of
 *   toggles: a toggle handler reads the selection of its render, so a run of
 *   them kept only the last (Select all and Clear changed one policy).
 */
function PolicySelector({ policies: providedPolicies, selectedPolicies, onPolicyToggle, onPoliciesSet, disabledReason, loading = false, noneReason, inactiveReason }) {
  const { displayable } = useMeasureCatalogue();
  const policies = (providedPolicies ?? displayable).filter(
    (policy) => policy.displayable !== false,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const presence = usePresence(isExpanded);
  const dropdownRef = useRef(null);
  const toggleRef = useRef(null);
  const listRef = useRef(null);

  // Up and down arrows move between the rows' checkboxes (Home and End to
  // the ends); from the open pill, Down goes to the first row
  const rowBoxes = () => [...(listRef.current?.querySelectorAll('input[type="checkbox"]') ?? [])];
  const handleListKeyDown = (event) => {
    const boxes = rowBoxes();
    const at = boxes.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: boxes.length - 1 }[event.key];
    if (to === undefined || boxes.length === 0) return;
    event.preventDefault();
    boxes[Math.max(0, Math.min(boxes.length - 1, at < 0 && event.key === "ArrowUp" ? boxes.length - 1 : to))].focus();
  };

  // Close dropdown when clicking outside, or on Escape (focus back on the
  // pill if it was in the menu: WCAG 2.1.2 and 2.4.3)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsExpanded(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      const inside = dropdownRef.current?.contains(document.activeElement);
      setIsExpanded(false);
      if (inside) toggleRef.current?.focus();
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isExpanded]);

  const selectedCount = selectedPolicies.length;
  const ids = policies.map((policy) => policy.id);
  const allSelected = ids.every((id) => selectedPolicies.includes(id));
  const noneSelected = !ids.some((id) => selectedPolicies.includes(id));
  const selectAllRef = useRef(null);
  const clearRef = useRef(null);
  // After Select all or Clear, focus goes to the other button once the
  // selection has re-rendered (it may have been disabled at the click)
  const focusNext = useRef(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next?.current && !next.current.disabled) next.current.focus();
  });
  // The whole selection in one update; without onPoliciesSet, one toggle per
  // policy that changes (a handler that accumulates them)
  const setAll = (next) => {
    if (onPoliciesSet) onPoliciesSet(next);
    else ids.filter((id) => selectedPolicies.includes(id) !== next.includes(id)).forEach((id) => onPolicyToggle(id));
  };
  const none = !loading && policies.length === 0;
  const reason = disabledReason ?? (none ? noneReason ?? "No policies are published yet" : undefined);
  const disabled = loading || Boolean(reason);
  // A view the policies do not change: the menu closes and does not open
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the pill goes inactive
    if (inactiveReason) setIsExpanded(false);
  }, [inactiveReason]);
  const unit = (n) => (n === 1 ? "policy" : "policies");

  return (
    <div className="policy-selector" ref={dropdownRef}>
      {/* A faded pill has no visible tip: its reason is in its name */}
      <Tip content={inactiveReason ? undefined : reason}>
      <button
        ref={toggleRef}
        className={`policy-selector-toggle band-control${inactiveReason ? " is-inactive" : ""}`}
        onClick={() => { if (!inactiveReason) setIsExpanded(!isExpanded); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || inactiveReason || disabled) return;
          event.preventDefault();
          if (!isExpanded) setIsExpanded(true);
          // The rows render with the menu: focus the first once it is there
          requestAnimationFrame(() => rowBoxes()[0]?.focus());
        }}
        aria-expanded={isExpanded}
        aria-disabled={inactiveReason ? "true" : undefined}
        // The name starts with the pill's visible text, "Policies All 7
        // policies" (WCAG 2.5.3, label in name), and says what it chooses
        aria-label={
          // A faded pill says why first, even while the policies load
          inactiveReason && (loading || none)
            ? `Policies: ${inactiveReason}`
            : loading
            ? "Policies: loading"
            : none
            ? `No policies yet${reason ? `: ${reason}` : ""}`
            : `Policies ${selectedCount === policies.length ? "All " : ""}${selectedCount}${selectedCount === policies.length ? "" : ` of ${policies.length}`} ${unit(policies.length)}${
                inactiveReason ? `: ${inactiveReason}` : reason ? `: ${reason}` : ", choose which to include"
              }`
        }
        aria-busy={loading || undefined}
        disabled={disabled}
      >
        <ListChecks className="band-control-icon" size={16} strokeWidth={2} aria-hidden="true" />
        <span className="band-control-text">
          {loading ? (
            // While the publication loads: the label alone, never "0 of 0"
            <span className="band-control-value">Policies</span>
          ) : none ? (
            <span className="band-control-value">No policies yet</span>
          ) : (
            <>
              <span className="band-control-label">Policies</span>
              {" "}
              {/* "All 9 policies" or "3 of 9 policies"; on a phone "All 9"
                  or "3 of 9" (the unit is hidden) */}
              <span className="band-control-value">
                {selectedCount === policies.length ? "All " : ""}
                <span className="policy-selector-count">{selectedCount}</span>
                {selectedCount === policies.length ? "" : ` of ${policies.length}`}
                <span className="band-control-unit"> {unit(policies.length)}</span>
              </span>
            </>
          )}
        </span>
        <PillChevron />
      </button>
      </Tip>

      {presence.mounted && (
        // A phone's sheet sits over a scrim; a tap on it closes the sheet
        <div className={`policy-selector-scrim ${popoverClass(presence.shown)}`} aria-hidden="true" onClick={() => setIsExpanded(false)} />
      )}
      {presence.mounted && (
        <div className={`policy-selector-dropdown ${popoverClass(presence.shown)}`} {...leavingProps(presence.shown)}>
          {/* The sheet's own title on a phone, where the pill is out of sight */}
          <div className="policy-selector-sheet-title" aria-hidden="true">Policies</div>
          <div className="policy-list" role="group" aria-label="Policies" ref={listRef} onKeyDown={handleListKeyDown}>
            {DIRECTION_ORDER.flatMap((direction) =>
              policies.filter((policy) => (DIRECTION_ORDER.includes(policy.direction) ? policy.direction : "neutral") === direction),
            ).map((policy) => {
              const summary = measureSummary(policy);
              const checked = selectedPolicies.includes(policy.id);
              return (
                // The info button sits outside the label, so it never ticks the box
                <div key={policy.id} className={checked ? "policy-item is-selected" : "policy-item"}>
                  <label className="policy-item-label">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onPolicyToggle(policy.id)}
                    />
                    <MeasureRowLabel tip={false} measure={policy} name={shortNameOf(policy)} nameClassName="policy-selector-name" />
                  </label>
                  {summary && <InfoTip content={summary} label={`About ${shortNameOf(policy)}`} />}
                </div>
              );
            })}
          </div>
          {/* Select all, clear and close: on a phone the list fills the
              screen, so it needs its own way out */}
          <div className="policy-selector-actions">
            {/* The button just used goes disabled, so focus moves to the
                other one rather than dropping to the page */}
            <button
              ref={selectAllRef}
              type="button"
              className="policy-selector-action"
              disabled={allSelected}
              onClick={() => {
                focusNext.current = clearRef;
                setAll(ids);
              }}
            >
              Select all
            </button>
            <button
              ref={clearRef}
              type="button"
              className="policy-selector-action"
              disabled={noneSelected}
              onClick={() => {
                focusNext.current = selectAllRef;
                setAll([]);
              }}
            >
              Clear
            </button>
            <button type="button" className="policy-selector-done" onClick={() => setIsExpanded(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PolicySelector;

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { stickyInset } from "../utils/tooltipPlacement";

/**
 * Why a policy's estimate differs from the official costing, behind the ⓘ
 * at the right of its Difference, in the chart (OBRDumbbellChart, a panel
 * by the row) and the table (OBRComparisonTable, a row under it): what each
 * side counts, the reviewer's reason where the official costing for the
 * year is not comparable, then the policy's note
 * (utils/obrDeviationNotes.js). Clicking the ⓘ again, the panel's close
 * button or Escape closes it.
 */

// The chart's panel: this far from its ⓘ and from the window's edges
const GAP = 6;
const EDGE = 8;
const PANEL_WIDTH = 420;

/** Whether a comparison row has anything to explain; a row not in force has not. */
export const hasExplanation = (row) => !row.status && Boolean(row.basis || row.note || row.notComparable);

/** The id of a row's explanation, for its ⓘ's aria-controls. */
export const explanationId = (baseId, row) => `${baseId}-why-${row.id}`;

/** A row's ⓘ: opens its explanation, or closes it when open. */
export function DeviationButton({ row, open, onToggle, controls, style }) {
  return (
    <button
      type="button"
      className={`info-tip obr-explain-button${open ? " is-open" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`Why ${row.name} differs from the official costing`}
      title={open ? "Hide why it differs" : "Why it differs"}
      onClick={() => onToggle(open ? null : row.id)}
      style={style}
    >
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** A row's explanation: what each side counts, why a year is not comparable, its note. */
export function DeviationExplanation({ row, yearLabel }) {
  return (
    <div className="obr-explain">
      {row.basis && (
        <p className="obr-explain-basis">
          <span className="obr-explain-label">What each side counts.</span> {row.basis}
        </p>
      )}
      {row.notComparable && (
        <p className="obr-explain-not-comparable">
          <span className="obr-explain-label">Not comparable in {yearLabel}.</span> {row.notComparable}
        </p>
      )}
      {row.note && <p className="obr-explain-note">{row.note}</p>}
    </div>
  );
}

/** The chart's panel for one row: its name, the explanation and a close button. */
export function DeviationPanel({ row, yearLabel, id, onClose, style, ref }) {
  return (
    <div ref={ref} className="obr-explain-panel" id={id} role="region" aria-label={`Why ${row.name} differs`} style={style}>
      <div className="obr-explain-head">
        <p className="obr-explain-title">{row.name}</p>
        <button type="button" className="obr-explain-close" aria-label="Close" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <DeviationExplanation row={row} yearLabel={yearLabel} />
    </div>
  );
}

/**
 * The chart's panel, drawn in the window (not inside the plot, which clips
 * it) by its row's ⓘ: under it, or above it where the window has no room
 * below; inside the window and clear of the sticky band, following the ⓘ
 * as the page scrolls.
 */
export function AnchoredDeviationPanel({ row, yearLabel, id, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector(`[aria-controls="${CSS.escape(id)}"]`);
      const panel = ref.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const height = panel.offsetHeight;
      const minTop = stickyInset(anchor) + EDGE;
      const fitsBelow = a.bottom + GAP + height <= window.innerHeight - EDGE;
      const top = fitsBelow || a.top - GAP - height < minTop ? a.bottom + GAP : a.top - GAP - height;
      const left = Math.min(Math.max(a.right - width, EDGE), window.innerWidth - width - EDGE);
      setPos({ top, left, width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [id]);
  const width = typeof window === "undefined" ? PANEL_WIDTH : Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
  return createPortal(
    <DeviationPanel
      ref={ref}
      row={row}
      yearLabel={yearLabel}
      id={id}
      onClose={onClose}
      style={pos ? { position: "fixed", ...pos } : { position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
    />,
    document.body,
  );
}

import { useId, useState } from "react";
import useCollapse from "../hooks/useCollapse";
import "./Disclosure.css";

/**
 * A disclosure, closed by default: a full-width button with a chevron, and
 * its content below once opened. One style for every expander on the
 * page: in a card's foot ("About this chart", "Compare with OBR
 * estimates"), where `inCard` puts a rule above it, or as a card of its own
 * ("About this data").
 *
 * While closed, `preview` is a one-line index of what is inside ("How it's
 * calculated · Source") and `chip` a short flag beside the title ("2
 * caveats"). Both sit inside the button but out of its accessible name,
 * which stays the title; the preview is shown to screen readers through
 * aria-describedby instead.
 *
 * `compact` is the inline form in a Policies card's footer row: the title
 * as a link-style button, the content opening below the row.
 */
function Disclosure({
  title,
  inCard = false,
  compact = false,
  id,
  className = "",
  contentClassName = "",
  preview,
  chip,
  children,
}) {
  const [open, setOpen] = useState(false);
  // Opens and shuts with an eased height (none with reduced motion)
  const { mounted, expanded } = useCollapse(open);
  const contentId = useId();
  const previewId = useId();
  const classes = [
    "disclosure",
    compact ? "disclosure-compact" : inCard ? "disclosure-in-card" : "disclosure-card",
    open ? "is-open" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div id={id} className={classes}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        aria-describedby={preview ? previewId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure-label">
          <span className="disclosure-title-row">
            <span className="disclosure-title">{title}</span>
            {chip && (
              <span className="disclosure-chip" aria-hidden="true">
                {chip}
              </span>
            )}
          </span>
          {preview && (
            <span id={previewId} className="disclosure-preview" aria-hidden="true">
              {preview}
              {chip && <span className="disclosure-sr-only"> · {chip}</span>}
            </span>
          )}
        </span>
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
          className="disclosure-chevron"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {mounted && (
        <div id={contentId} className={`expander-body ${expanded ? "is-expanded" : ""}`}>
          <div className="expander-inner">
            <div className={`disclosure-content ${contentClassName}`.trim()}>{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Disclosure;

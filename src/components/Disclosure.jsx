import { useId, useState } from "react";
import useCollapse from "../hooks/useCollapse";

/**
 * A disclosure, closed by default: a full-width button with a chevron, and
 * its content below once opened. One style for every expander on the
 * page: in a card's foot ("About this chart", "Compare with OBR
 * estimates"), where `inCard` puts a rule above it, or as a card of its own
 * ("About selected policies", "About this data").
 */
function Disclosure({ title, inCard = false, id, className = "", contentClassName = "", children }) {
  const [open, setOpen] = useState(false);
  // Opens and shuts with an eased height (none with reduced motion)
  const { mounted, expanded } = useCollapse(open);
  const contentId = useId();
  const classes = ["disclosure", inCard ? "disclosure-in-card" : "disclosure-card", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div id={id} className={classes}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        {title}
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

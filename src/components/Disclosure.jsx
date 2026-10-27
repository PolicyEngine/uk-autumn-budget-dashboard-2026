import { useEffect, useId, useRef, useState } from "react";
import useCollapse from "../hooks/useCollapse";
import "./Disclosure.css";

/**
 * A disclosure, closed by default: a full-width button with a chevron, and
 * its content below once opened. One style for every expander on the
 * page: in a card's foot ("About this chart", "Compare with the
 * official costings"), where `inCard` puts a rule above it, or as a card of its own
 * ("About this data").
 *
 * While closed, `preview` is a one-line index of what is inside ("How it's
 * calculated · Caveats · Source"), muted under the title. It sits inside
 * the button but out of its accessible name, which stays the title; screen
 * readers get it through aria-describedby instead.
 *
 * `compact` is the inline form in a Policies card's footer row: the title
 * as a link-style button, the content opening below the row.
 *
 * `keepMounted` keeps the closed content in the page, hidden, so a link to
 * an id inside it still finds it; `openDisclosuresAround` then opens it.
 */
export const DISCLOSURE_OPEN_EVENT = "disclosure:open";

/** Open every disclosure (and native <details>) that holds `element`, or is it. */
export function openDisclosuresAround(element) {
  let node = element;
  while (node) {
    if (node.tagName === "DETAILS") node.open = true;
    if (node.classList?.contains("disclosure")) node.dispatchEvent(new CustomEvent(DISCLOSURE_OPEN_EVENT));
    node = node.parentElement;
  }
}

function Disclosure({
  title,
  inCard = false,
  compact = false,
  id,
  className = "",
  contentClassName = "",
  preview,
  keepMounted = false,
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  // Opened from a link to something inside it (openDisclosuresAround)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onOpen = () => setOpen(true);
    root.addEventListener(DISCLOSURE_OPEN_EVENT, onOpen);
    return () => root.removeEventListener(DISCLOSURE_OPEN_EVENT, onOpen);
  }, []);
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
    <div ref={rootRef} id={id} className={classes}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        aria-describedby={preview ? previewId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure-label">
          <span className="disclosure-title">{title}</span>
          {preview && (
            <span id={previewId} className="disclosure-preview" aria-hidden="true">
              {preview}
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
      {(mounted || keepMounted) && (
        <div
          id={contentId}
          className={`expander-body ${expanded ? "is-expanded" : ""}`}
          hidden={!mounted || undefined}
        >
          <div className="expander-inner">
            <div className={`disclosure-content ${contentClassName}`.trim()}>{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Disclosure;

import { useId, useState } from "react";
import { InfoIcon } from "./Note";
import "./CollapsibleNote.css";

/**
 * A note under a chart that reads in one short line, its detail behind a
 * "More info" button (closed by default; "Less info" once open, with
 * aria-expanded). The line itself must say all a reader needs to read the
 * chart; the detail only explains it. One style for every such note.
 *
 * @param {{lead: React.ReactNode, className?: string, children: React.ReactNode}} props
 */
function CollapsibleNote({ lead, className = "", children }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <div className={`note note-collapsible ${className}`.trim()}>
      <p className="note-line">
        <InfoIcon />
        <span className="note-lead">
          {lead}{" "}
          <button
            type="button"
            className="note-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Less info" : "More info"}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="note-chevron"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </span>
      </p>
      <div id={detailId} className="note-detail" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export default CollapsibleNote;

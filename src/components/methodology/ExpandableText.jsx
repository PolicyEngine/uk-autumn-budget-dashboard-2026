import { useId, useState } from "react";

// Text longer than this shows its first two lines, with a button for the
// rest. The full text stays in the page (clipped by CSS), so search and
// screen readers find all of it.
const LONG = 200;

/**
 * A paragraph clamped to two lines when long, with "Show more" / "Show less".
 *
 * @param {Object} props
 * @param {string} props.text
 */
function ExpandableText({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (text.length < LONG) return text;
  return (
    <>
      <span id={id} className={`method-clamp${open ? " method-clamp-open" : ""}`}>
        {text}
      </span>
      <button
        type="button"
        className="method-clamp-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Show less" : "Show more"}
      </button>
    </>
  );
}

export default ExpandableText;

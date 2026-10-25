import { useId, useState } from "react";

// A single text longer than this shows its first two lines, with a button
// for the rest. The full text stays in the page (clipped by CSS), so search
// and screen readers find all of it.
const LONG = 200;

function Toggle({ open, controls, onToggle }) {
  return (
    <button
      type="button"
      className="method-clamp-toggle"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? "Show less" : "Show more"}
    </button>
  );
}

/**
 * A note that opens on demand. A list shows its first line as a summary
 * and the rest as bullets under "Show more"; a long string is clamped to
 * two lines.
 *
 * @param {Object} props
 * @param {string | string[]} props.text
 */
function ExpandableText({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = () => setOpen((value) => !value);

  if (Array.isArray(text)) {
    const [summary, ...rest] = text;
    return (
      <>
        <span className="method-clamp-summary">{summary}</span>
        {rest.length > 0 && (
          <>
            <ul id={id} className="method-points method-points-more" hidden={!open}>
              {rest.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <Toggle open={open} controls={id} onToggle={toggle} />
          </>
        )}
      </>
    );
  }

  if (text.length < LONG) return text;
  return (
    <>
      <span id={id} className={`method-clamp${open ? " method-clamp-open" : ""}`}>
        {text}
      </span>
      <Toggle open={open} controls={id} onToggle={toggle} />
    </>
  );
}

export default ExpandableText;

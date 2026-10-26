import "./publication.css";

/** Says why a figure is not shown. Never stands in for a number. */
function UnavailableNotice({ reason, children }) {
  return (
    <div className="publication-unavailable" role="status">
      <p className="publication-unavailable-reason">{reason}</p>
      {children}
    </div>
  );
}

export default UnavailableNotice;

/**
 * Takes selected measures that are no longer available out of the reader's
 * selection, at the reader's request. Totals are never narrowed silently.
 */
export function RemoveUnavailable({ names, onRemove }) {
  return (
    <button type="button" className="publication-unavailable-action" onClick={onRemove}>
      Remove {names.join(", ")} from the selection
    </button>
  );
}

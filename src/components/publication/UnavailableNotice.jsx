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

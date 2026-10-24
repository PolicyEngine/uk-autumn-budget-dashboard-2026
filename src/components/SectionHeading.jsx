/** A section's title and one-line subtitle, on the page above its cards. */
function SectionHeading({ title, subtitle, id, className = "" }) {
  return (
    <div id={id} className={`section-heading ${className}`.trim()}>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export default SectionHeading;

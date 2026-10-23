/** A section's title and one-line subtitle, on the page above its cards. */
function SectionHeading({ title, subtitle }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export default SectionHeading;

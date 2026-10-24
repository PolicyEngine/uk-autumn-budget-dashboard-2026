/**
 * A two-column fact grid for the Methodology view: a short term on the
 * left, what it means on the right; stacked on a phone.
 *
 * @param {Object} props
 * @param {Array<[import("react").ReactNode, import("react").ReactNode]>} props.items
 * @param {string} [props.className]
 */
function FactList({ items, className = "" }) {
  return (
    <dl className={`method-facts ${className}`.trim()}>
      {items.map(([term, description], index) => (
        <div key={index} className="method-fact">
          <dt>{term}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}

export default FactList;

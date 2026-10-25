// A long description reads more easily with its first sentence set in bold
// as a summary; the wording is unchanged.
const LONG = 220;
const FIRST_SENTENCE = /^(.{20,180}?[.:])\s+(?=[A-Z0-9£(])/;

function Description({ children }) {
  if (typeof children !== "string" || children.length < LONG) return children;
  const match = children.match(FIRST_SENTENCE);
  if (!match) return children;
  return (
    <>
      <strong className="method-fact-summary">{match[1]}</strong> {children.slice(match[0].length)}
    </>
  );
}

/**
 * A two-column fact grid for the Methodology view: a short term on the
 * left, what it means on the right; stacked on a phone. An item's optional
 * third element is an icon shown before the term.
 *
 * @param {Object} props
 * @param {Array<[import("react").ReactNode, import("react").ReactNode, import("react").ComponentType?]>} props.items
 * @param {string} [props.className]
 */
function FactList({ items, className = "" }) {
  return (
    <dl className={`method-facts ${className}`.trim()}>
      {items.map(([term, description, Icon], index) => (
        <div key={index} className="method-fact">
          <dt>
            {Icon && (
              <span className="method-fact-icon" aria-hidden="true">
                <Icon strokeWidth={1.75} />
              </span>
            )}
            {term}
          </dt>
          <dd>
            <Description>{description}</Description>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default FactList;

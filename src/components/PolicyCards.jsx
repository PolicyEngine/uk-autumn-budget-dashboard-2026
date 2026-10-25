import TitleIcon from "./TitleIcon";

// Each group's heading and arrow, by the direction the catalogue gives a
// measure's budgetary effect. Cards carry no icon per measure: a map by
// measure id would be a measure list of the page's own.
const GROUPS = [
  ["Raises revenue", "revenue", "arrowUp"],
  ["Costs revenue", "cost", "arrowDown"],
  ["Other measures", "neutral", null],
];

/** A fact row's small muted icon (Starts, Type, Details): separable, as
 *  the catalogue's metadata may not carry these rows */
const FactIcon = ({ name }) => (
  <TitleIcon name={name} bare size={13} className="policy-fact-icon" />
);

/**
 * "About selected policies": a card per selected policy, grouped by whether
 * it raises or costs revenue, in the legends' order. Each card gives what
 * changes, when it starts and what kind of measure it is, with its main
 * assumption behind "Details" and a source where one exists. Revenue
 * figures stay in the charts.
 */
function PolicyCards({ policies, selectedPolicies }) {
  return GROUPS.map(([heading, direction, arrow]) => {
    const items = policies.filter((policy) =>
      policy.displayable === true && selectedPolicies.includes(policy.id) && policy.direction === direction,
    ).sort((a, b) => a.order - b.order);
    if (!items.length) return null;
    return (
      <div key={heading} className="policy-group">
        <h3 className="policy-group-heading">
          {arrow && <TitleIcon name={arrow} bare size={14} className="policy-group-icon" />}
          {heading}
        </h3>
        <ul className="policy-cards">
          {items.map((policy) => (
            <li key={policy.id} className="policy-card">
              <p className="policy-card-name">
                <span
                  className="policy-card-swatch"
                  style={{ background: policy.color }}
                  aria-hidden="true"
                />
                {policy.label ?? policy.name}
              </p>
              <p className="policy-card-summary">{policy.summary ?? policy.description}</p>
              {(policy.starts || policy.type) && <dl className="policy-card-facts">
                {policy.starts && <div className="policy-chip">
                  <dt>
                    <FactIcon name="calendar" />
                    Starts
                  </dt>
                  <dd>{policy.starts}</dd>
                </div>}
                {policy.type && <div className="policy-chip">
                  <dt>
                    <FactIcon name="tag" />
                    Type
                  </dt>
                  <dd>{policy.type}</dd>
                </div>}
              </dl>}
              {(policy.details || policy.source) && (
                <div className="policy-card-foot">
                  {policy.details && (
                    <details className="policy-card-details">
                      <summary>
                        <FactIcon name="link" />
                        Details
                      </summary>
                      <p>{policy.details}</p>
                    </details>
                  )}
                  {policy.source && (
                    <a
                      className="policy-card-source"
                      href={policy.source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {policy.source.label}
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  });
}

export default PolicyCards;

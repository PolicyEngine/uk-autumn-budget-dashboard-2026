const GROUPS = [
  ["Raises revenue", "revenue"],
  ["Costs revenue", "cost"],
  ["Other measures", "neutral"],
];

/**
 * "About selected policies": a card per selected policy, grouped by whether
 * it raises or costs revenue, in the legends' order. Each card gives what
 * changes, when it starts and what kind of measure it is, with its main
 * assumption behind "Details" and a source where one exists. Revenue
 * figures stay in the charts.
 */
function PolicyCards({ policies, selectedPolicies }) {
  return GROUPS.map(([heading, direction]) => {
    const items = policies.filter((policy) =>
      policy.displayable === true && selectedPolicies.includes(policy.id) && policy.direction === direction,
    ).sort((a, b) => a.order - b.order);
    if (!items.length) return null;
    return (
      <div key={heading} className="policy-group">
        <h3 className="policy-group-heading">{heading}</h3>
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
                  <dt>Starts</dt>
                  <dd>{policy.starts}</dd>
                </div>}
                {policy.type && <div className="policy-chip">
                  <dt>Type</dt>
                  <dd>{policy.type}</dd>
                </div>}
              </dl>}
              {(policy.details || policy.source) && (
                <div className="policy-card-foot">
                  {policy.details && (
                    <details className="policy-card-details">
                      <summary>Details</summary>
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

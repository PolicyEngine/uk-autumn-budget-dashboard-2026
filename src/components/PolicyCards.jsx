import { useMeasureCatalogue } from "../utils/measureCatalogue";

const GROUPS = [
  ["Raises revenue", "revenue"],
  ["Costs revenue", "cost"],
  ["Other measures", "neutral"],
];

/**
 * "About selected policies": a card per selected policy, grouped by whether
 * it raises or costs revenue, in the legends' order, all from the published
 * catalogue. Each card gives what changes, when it starts and what kind of
 * measure it is (the measure's published `display` metadata), with its main
 * assumption behind "Details" and a source where one exists. A measure
 * published without card text shows its public description. Revenue
 * figures stay in the charts.
 */
function PolicyCards({ selectedPolicies }) {
  const { displayable } = useMeasureCatalogue();
  return GROUPS.map(([heading, direction]) => {
    const items = displayable.filter(
      (policy) => selectedPolicies.includes(policy.id) && policy.direction === direction,
    );
    if (!items.length) return null;
    return (
      <div key={heading} className="policy-group">
        <h3 className="policy-group-heading">{heading}</h3>
        <ul className="policy-cards">
          {items.map((policy) => {
            const card = policy.display ?? {};
            return (
              <li key={policy.id} className="policy-card">
                <p className="policy-card-name">
                  <span
                    className="policy-card-swatch"
                    style={{ background: policy.color }}
                    aria-hidden="true"
                  />
                  {policy.name}
                </p>
                <p className="policy-card-summary">{card.summary ?? policy.description}</p>
                {(card.starts || card.type) && (
                  <dl className="policy-card-facts">
                    {card.starts && (
                      <div className="policy-chip">
                        <dt>Starts</dt>
                        <dd>{card.starts}</dd>
                      </div>
                    )}
                    {card.type && (
                      <div className="policy-chip">
                        <dt>Type</dt>
                        <dd>{card.type}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {(card.details || card.source) && (
                  <div className="policy-card-foot">
                    {card.details && (
                      <details className="policy-card-details">
                        <summary>Details</summary>
                        <p>{card.details}</p>
                      </details>
                    )}
                    {card.source && (
                      <a
                        className="policy-card-source"
                        href={card.source.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {card.source.label}
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  });
}

export default PolicyCards;

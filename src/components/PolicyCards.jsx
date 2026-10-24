import { ALL_POLICY_NAMES, POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";

const GROUPS = [
  ["Raises revenue", true],
  ["Costs revenue", false],
];

/**
 * "About selected policies": a card per selected policy, grouped by whether
 * it raises or costs revenue, in the legends' order. Each card gives what
 * changes, when it starts and what kind of measure it is, with its main
 * assumption behind "Details" and a source where one exists. Revenue
 * figures stay in the charts.
 */
function PolicyCards({ policies, selectedPolicies }) {
  return GROUPS.map(([heading, raises]) => {
    const items = ALL_POLICY_NAMES.map((name) =>
      policies.find((policy) => policy.name === name),
    ).filter(
      (policy) =>
        policy &&
        selectedPolicies.includes(policy.id) &&
        REVENUE_RAISING_NAMES.has(policy.name) === raises,
    );
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
                  style={{ background: POLICY_COLORS[policy.name] }}
                  aria-hidden="true"
                />
                {policy.name}
              </p>
              <p className="policy-card-summary">{policy.summary}</p>
              <dl className="policy-card-facts">
                <div className="policy-chip">
                  <dt>Starts</dt>
                  <dd>{policy.starts}</dd>
                </div>
                <div className="policy-chip">
                  <dt>Type</dt>
                  <dd>{policy.type}</dd>
                </div>
              </dl>
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

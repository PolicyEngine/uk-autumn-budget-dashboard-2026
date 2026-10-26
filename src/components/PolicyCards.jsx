import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
  POLICY_ICONS,
  REVENUE_RAISING_NAMES,
} from "../utils/policyConfig";
import TitleIcon from "./TitleIcon";

const GROUPS = [
  ["Raises revenue", true, "arrowUp"],
  ["Costs revenue", false, "arrowDown"],
];

/** A fact row's small muted icon (Starts, Type, Details): separable, as
 *  the catalogue's metadata may not carry these rows */
const FactIcon = ({ name }) => (
  <TitleIcon name={name} bare size={13} className="policy-fact-icon" />
);

/**
 * The Policies view: a card per policy given, grouped by whether
 * it raises or costs revenue, in the legends' order. Each card gives what
 * changes, when it starts and what kind of measure it is, with its main
 * assumption behind "Details" and a source where one exists. Revenue
 * figures stay in the charts.
 */
function PolicyCards({ policies, selectedPolicies }) {
  return GROUPS.map(([heading, raises, arrow]) => {
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
        <h3 className="policy-group-heading">
          <TitleIcon name={arrow} bare size={14} className="policy-group-icon" />
          {heading}
        </h3>
        <ul className="policy-cards">
          {items.map((policy) => (
            <li key={policy.id} className="policy-card">
              <p className="policy-card-name">
                <TitleIcon name={POLICY_ICONS[policy.id]} />
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
                  <dt>
                    <FactIcon name="calendar" />
                    Starts
                  </dt>
                  <dd>{policy.starts}</dd>
                </div>
                <div className="policy-chip">
                  <dt>
                    <FactIcon name="tag" />
                    Type
                  </dt>
                  <dd>{policy.type}</dd>
                </div>
              </dl>
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

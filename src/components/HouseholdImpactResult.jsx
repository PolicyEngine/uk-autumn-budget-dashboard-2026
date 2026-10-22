import { fiscalYearLabel } from "../utils/publication/format";

/** £ to the pound, en-GB, with a true minus for a loss. */
export function formatPounds(value, { signed = false } = {}) {
  const pounds = `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
  if (!signed) return value < 0 ? `−${pounds}` : pounds;
  if (Math.round(value) === 0) return pounds;
  return `${value > 0 ? "+" : "−"}${pounds}`;
}

/**
 * The household impact app's answer: net income before and after the
 * selected measures in one year, and which measures the figures include.
 */
function HouseholdImpactResult({ result, policies }) {
  const name = (id) => policies.find((policy) => policy.id === id)?.name ?? id;
  const { before, after, change } = result.net_income;
  const { included, not_affected: notAffected, not_modelled: notModelled } =
    result.measures;
  const affecting = included.filter((id) => !notAffected.includes(id));
  const direction = change > 0.5 ? "gain" : change < -0.5 ? "loss" : "none";

  return (
    <section className="household-impact-result" aria-label="Your result">
      <h3>Your household in {fiscalYearLabel(result.year)}</h3>
      <dl className="household-impact-figures">
        <div>
          <dt>Net income before the Budget</dt>
          <dd>{formatPounds(before)}</dd>
        </div>
        <div>
          <dt>Net income after the Budget</dt>
          <dd>{formatPounds(after)}</dd>
        </div>
        <div className={`household-impact-change household-impact-${direction}`}>
          <dt>Change</dt>
          <dd>{formatPounds(change, { signed: true })}</dd>
        </div>
      </dl>

      {affecting.length > 0 && (
        <>
          <h4 id="household-included">Included</h4>
          <ul aria-labelledby="household-included">
            {affecting.map((id) => (
              <li key={id}>{name(id)}</li>
            ))}
          </ul>
        </>
      )}
      {notAffected.length > 0 && (
        <>
          <h4 id="household-not-affected">Not affected by your answers</h4>
          <ul aria-labelledby="household-not-affected">
            {notAffected.map((id) => (
              <li key={id}>{name(id)}</li>
            ))}
          </ul>
        </>
      )}
      {notModelled.length > 0 && (
        <>
          <h4 id="household-not-modelled">Not included</h4>
          <ul aria-labelledby="household-not-modelled">
            {notModelled.map(({ id, reason }) => (
              <li key={id}>
                <strong>{name(id)}</strong>: {reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default HouseholdImpactResult;

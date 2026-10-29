import { money, signedMoney } from "../../utils/singleYear";
import "./SurplusEarningsCard.css";

// How each month's status reads under its amount
const STATUS_TEXT = {
  award: null,
  award_ended: "Award ends",
  new_award: "New award",
  no_award: "No award",
};

/** The words under a month's amount: what happened to the award, and any surplus. */
function statusText(side) {
  if (!side) return null;
  const parts = [STATUS_TEXT[side.status] ?? null];
  if (side.surplusCounted > 0) parts.push(`${money(side.surplusCounted)} counted`);
  if (side.surplusCarried > 0) parts.push(`${money(side.surplusCarried)} carried`);
  const text = parts.filter(Boolean).join("; ");
  return text || null;
}

function SideCell({ side }) {
  const words = statusText(side);
  return (
    <td className={`num surplus-side is-${side?.status ?? "none"}`}>
      {side ? money(side.universalCredit) : "—"}
      {words && <span className="surplus-status">{words}</span>}
    </td>
  );
}

/**
 * The Universal Credit surplus earnings threshold measure for a household
 * that entered its monthly pay (#356): its Universal Credit in each month
 * of the year at the current-law threshold (£300) and at the Budget's
 * (£2,500), where an award ends or starts, the surplus counted and
 * carried, and the measure's change. A household the measure cannot reach
 * gets its reason and no months. Months sent but no figures back (an API
 * from before them) read as unavailable, never as £0. Nothing for a
 * household that sent no months.
 *
 * @param {Object} props
 * @param {ReturnType<import("../../utils/surplusEarnings").normaliseSurplusEarnings>} props.surplus
 * @param {boolean} props.asked - Whether the request carried monthly pay
 * @param {string} props.yearLabel - "2027-28"
 */
export default function SurplusEarningsCard({ surplus, asked, yearLabel }) {
  if (!asked) return null;
  const titleId = "surplus-earnings-title";
  const title = `Universal Credit month by month, ${yearLabel}`;
  if (!surplus) {
    return (
      <section className="card single-year-card surplus-earnings" aria-labelledby={titleId}>
        <h3 className="surplus-title" id={titleId}>
          {title}
        </h3>
        <p className="single-year-quiet">
          The month-by-month figures for the Universal Credit surplus earnings threshold are unavailable for this answer. Your
          result leaves this measure out.
        </p>
      </section>
    );
  }
  const { thresholds, total, months } = surplus;
  return (
    <section className="card single-year-card surplus-earnings" aria-labelledby={titleId}>
      <h3 className="surplus-title" id={titleId}>
        {title}
      </h3>
      {months && total ? (
        <>
          <p className="surplus-lead">
            <strong className={surplus.change > 0 ? "is-gain" : surplus.change < 0 ? "is-loss" : undefined}>
              {signedMoney(surplus.change)}
            </strong>{" "}
            from the surplus earnings threshold: {money(total.budget)} over the year with the Budget&apos;s{" "}
            {money(thresholds.budget)} threshold, against {money(total.currentLaw)} at the {money(thresholds.currentLaw)}{" "}
            threshold current law sets.
          </p>
          <div className="surplus-table-scroll">
            <table className="surplus-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">
                    Pay
                  </th>
                  <th scope="col" className="num">
                    Earned income
                  </th>
                  <th scope="col" className="num">
                    Nil above
                  </th>
                  <th scope="col" className="num">
                    Current law ({money(thresholds.currentLaw)})
                  </th>
                  <th scope="col" className="num">
                    Budget ({money(thresholds.budget)})
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr key={month.key}>
                    <th scope="row">
                      <span aria-hidden="true">{month.short}</span>
                      <span className="visually-hidden">{month.label}</span>
                    </th>
                    <td className="num">
                      {money(month.pay + (month.partnerPay ?? 0))}
                    </td>
                    <td className="num">{money(month.earnedIncome)}</td>
                    <td className="num">{money(month.nilThreshold)}</td>
                    <SideCell side={month.currentLaw} />
                    <SideCell side={month.budget} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="single-year-quiet">
            Pay is before tax, yours and any partner&apos;s; earned income is after income tax, National Insurance and pension
            contributions, as Universal Credit counts it. Universal Credit is nil above the earnings in &ldquo;Nil above&rdquo;. When
            a month&apos;s earnings end an award, earnings above that plus the threshold are carried into the next claims, for up to
            five months.
          </p>
        </>
      ) : (
        <p className="surplus-lead">
          <strong>No change in {yearLabel}.</strong> {surplus.note}
        </p>
      )}
      {surplus.method && <p className="single-year-quiet">{surplus.method}</p>}
    </section>
  );
}

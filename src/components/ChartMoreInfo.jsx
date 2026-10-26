import Disclosure from "./Disclosure";
import "./ChartMoreInfo.css";
import useMeasureRevenue from "../hooks/useMeasureRevenue";
import { zeroReason } from "../utils/legendMembership";
import { openPopulationSub, populationSubHref } from "../utils/populationSub";

const fiscalYear = (year) => `${year}-${String(year + 1).slice(-2)}`;
const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * An employer cost's reason: what it does instead, with its revenue in the
 * year from budgetary_impact.csv (left out until loaded), and a link to
 * Public finances.
 */
function EmployerReason({ id, year, text }) {
  const revenue = useMeasureRevenue(id, year);
  const finances = (
    <a
      href={populationSubHref("finances")}
      onClick={(event) => {
        event.preventDefault();
        openPopulationSub("finances");
      }}
    >
      Public finances
    </a>
  );
  return (
    <>
      Employers pay less National Insurance (
      {revenue !== null && <>about £{Math.abs(revenue).toFixed(1)}bn in {fiscalYear(year)}; </>}
      see {finances}). {text}.
    </>
  );
}

/**
 * The selected measures that are £0 for households in the year shown, for a
 * card's "More info": a lead line, then one measure per line with why.
 */
export function ZeroMeasuresDetail({ zero, year, period, pastEvent = false }) {
  const count = zero.length === 1 ? "1 measure is" : `${zero.length} measures are`;
  return (
    <div className="zero-measures">
      <p className="zero-measures-lead">
        {count} £0 for households {period ?? `in ${fiscalYear(year)}`}:
      </p>
      <ul className="zero-measures-list">
        {zero.map((member) => {
          const reason = zeroReason(member, year, { pastEvent });
          return (
            <li key={member.id} data-zero-measure={member.id}>
              <strong>{member.name}</strong>:{" "}
              {reason.kind === "employer" ? (
                <EmployerReason id={member.id} year={year} text={reason.text} />
              ) : (
                <>{capitalised(reason.text)}.</>
              )}
            </li>
          );
        })}
      </ul>
      <p>They are greyed out in the key and left out of the tooltip.</p>
    </div>
  );
}

/**
 * A chart card's "More info", at the foot of the card: the page's one
 * disclosure (Disclosure, as "About this chart" and the household cards'
 * "More info"), closed by default. It holds the £0 measures (legendMembership)
 * and any other notes on reading the chart (`children`); nothing when it
 * would be empty.
 *
 * `period` replaces "in 2027-28" for a chart over several years (its £0
 * measures are £0 in all of them).
 *
 * `pastEvent`: the members are a past fiscal event's, so no £0 measure is
 * given a reason written for this Budget's (zeroReason).
 *
 * @param {{members?: Array<{id: string, name: string, muted: boolean}>, year: number, period?: string, pastEvent?: boolean, children?: React.ReactNode}} props
 */
function ChartMoreInfo({ members = [], year, period, pastEvent = false, children }) {
  const zero = members.filter((member) => member.muted);
  const extra = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasExtra = Array.isArray(extra) ? extra.length > 0 : Boolean(extra);
  if (!zero.length && !hasExtra) return null;
  return (
    <Disclosure inCard title="More info" className="chart-more-info" contentClassName="chart-more-info-content">
      {zero.length > 0 && <ZeroMeasuresDetail zero={zero} year={year} period={period} pastEvent={pastEvent} />}
      {extra}
    </Disclosure>
  );
}

export default ChartMoreInfo;

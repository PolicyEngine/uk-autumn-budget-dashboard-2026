import CollapsibleNote from "./CollapsibleNote";
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
 * One short line under a household chart: how many selected measures are
 * £0 for households in the year shown (greyed out in the key, left out of
 * the tooltip), with each one and why behind "More info"
 * (legendMembership). Nothing when every selected measure has an effect.
 *
 * @param {{members: Array<{id: string, name: string, muted: boolean}>, year: number}} props
 */
function ZeroMeasuresNote({ members, year }) {
  const zero = members.filter((member) => member.muted);
  if (!zero.length) return null;
  const count = zero.length === 1 ? "1 measure is" : `${zero.length} measures are`;
  return (
    <CollapsibleNote className="zero-measures-note" lead={`${count} £0 for households in ${fiscalYear(year)}.`}>
      <ul>
        {zero.map((member) => {
          const reason = zeroReason(member, year);
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
      <p>Greyed out in the key and left out of the tooltip.</p>
    </CollapsibleNote>
  );
}

export default ZeroMeasuresNote;

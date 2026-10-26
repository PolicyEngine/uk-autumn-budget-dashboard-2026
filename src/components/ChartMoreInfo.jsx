import Disclosure from "./Disclosure";
import "./ChartMoreInfo.css";
import InfoSections, { caveatChip, hasInfo, infoPreview } from "./InfoSections";

/** The one name of every chart card's disclosure. */
export const ABOUT_THIS_CHART = "About this chart";
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
 * The selected measures that are £0 for households in the year shown, as
 * one caveat in a card's "About this chart": a lead line, then one measure
 * per line with why.
 */
export function ZeroMeasuresDetail({ zero, year, period }) {
  const count = zero.length === 1 ? "1 selected measure is" : `${zero.length} selected measures are`;
  return (
    <div className="zero-measures">
      <span className="zero-measures-lead">
        {count} £0 for households {period ?? `in ${fiscalYear(year)}`}, so the key folds{" "}
        {zero.length === 1 ? "it" : "them"} under &ldquo;with no effect&rdquo; and the tooltip leaves{" "}
        {zero.length === 1 ? "it" : "them"} out:
      </span>
      <ul className="zero-measures-list">
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
    </div>
  );
}

/**
 * A chart card's "About this chart", at the foot of the card: the page's
 * one disclosure (Disclosure), closed by default, with a one-line preview
 * of what is inside and a caveat count. Its content is `info`, in the fixed
 * sections of InfoSections; the selected measures that are £0 in the year
 * shown (legendMembership) join the caveats. Nothing when it would be empty.
 *
 * `period` replaces "in 2027-28" for a chart over several years (its £0
 * measures are £0 in all of them).
 *
 * @param {{info?: import("./InfoSections").ChartInfo, members?: Array<{id: string, name: string, muted: boolean}>, year?: number, period?: string}} props
 */
function ChartMoreInfo({ info = {}, members = [], year, period, children }) {
  // Cards not yet given sections: their notes, as "What it shows"
  const legacy = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const zero = members.filter((member) => member.muted);
  const full = {
    ...info,
    shows: info.shows ?? (legacy.length ? <span className="chart-more-info-legacy">{legacy}</span> : null),
    caveats: [
      ...(info.caveats || []),
      zero.length > 0 && <ZeroMeasuresDetail key="zero" zero={zero} year={year} period={period} />,
    ],
  };
  if (!hasInfo(full)) return null;
  return (
    <Disclosure
      inCard
      title={ABOUT_THIS_CHART}
      className="chart-more-info"
      preview={infoPreview(full)}
      chip={caveatChip(full)}
    >
      <InfoSections info={full} />
    </Disclosure>
  );
}

export default ChartMoreInfo;

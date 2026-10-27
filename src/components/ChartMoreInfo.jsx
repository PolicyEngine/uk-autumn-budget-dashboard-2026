import Disclosure from "./Disclosure";
import "./ChartMoreInfo.css";
import InfoSections, { hasInfo, infoPreview, nestedItem } from "./InfoSections";

/** The one name of every chart card's disclosure. */
export const ABOUT_THIS_CHART = "About this chart";
import useMeasureRevenue from "../hooks/useMeasureRevenue";
import { inForceShort, zeroReason } from "../utils/legendMembership";
import { policyDetailsFor, shortNameOf } from "../utils/policyDetails";
import { openPopulationSub, populationSubHref } from "../utils/populationSub";

const fiscalYear = (year) => `${year}-${String(year + 1).slice(-2)}`;

/**
 * An employer cost's reason: what it does instead, with its revenue in the
 * year from budgetary_impact.csv (left out until loaded), and a link to
 * Public finances.
 */
function EmployerReason({ id, year }) {
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
      employers pay less National Insurance (
      {revenue !== null && <>about £{Math.abs(revenue).toFixed(1)}bn in {fiscalYear(year)}; </>}
      see {finances}), and wages are held fixed in the model
    </>
  );
}

/**
 * The selected policies that are £0 for households in the year shown, as
 * one caveat in a card's "About this chart" (nestedItem): a lead line, then
 * one policy a bullet, its short name and why: "Threshold freeze — from
 * April 2031". One policy reads as one line.
 */
export function zeroMeasuresItem({ zero, year, period }) {
  return nestedItem(
    <>No effect on household incomes {period ?? `in ${fiscalYear(year)}`}:</>,
    zero.map((member) => {
      const reason = zeroReason(member, year);
      return (
        <span key={member.id} data-zero-measure={member.id}>
          {shortNameOf(member)} —{" "}
          {reason.kind === "employer" ? (
            <EmployerReason id={member.id} year={year} />
          ) : reason.kind === "not_in_force" ? (
            inForceShort(policyDetailsFor(member))
          ) : (
            reason.text
          )}
        </span>
      );
    }),
    "zero-measures",
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
      zero.length > 0 && zeroMeasuresItem({ zero, year, period }),
    ],
  };
  if (!hasInfo(full)) return null;
  return (
    <Disclosure
      inCard
      title={ABOUT_THIS_CHART}
      className="chart-more-info"
      preview={infoPreview(full)}
    >
      <InfoSections info={full} />
    </Disclosure>
  );
}

export default ChartMoreInfo;

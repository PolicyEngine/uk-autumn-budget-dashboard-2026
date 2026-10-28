import { ExternalLink, Landmark } from "lucide-react";
import Disclosure from "../Disclosure";
import SectionHeading from "../SectionHeading";
import { PolicyCard } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
  OTHER_MEASURES_NOTE,
  TABLE_6_1_URL,
  UNMODELLED_MEASURES,
} from "../../utils/unmodelledMeasures";
import "./UnmodelledMeasures.css";

export const UNMODELLED_TITLE = "Budget policies we do not model";
export const UNMODELLED_SUBTITLE = "What each policy changes, who it reaches and why we leave it out.";

// £ million as Table 6.1 prints it: a sign on every figure but zero, with a true minus
const millions = new Intl.NumberFormat("en-GB", { signDisplay: "exceptZero" });
export const formatMillions = (value) => millions.format(value).replace("-", "−");

/**
 * An external link in the cards' style: the icon, kept with the label's
 * last word, and the new tab said to screen readers.
 */
function SourceLink({ href, children }) {
  const split = children.lastIndexOf(" ") + 1;
  return (
    <a className="umm-link" href={href} {...EXTERNAL}>
      {children.slice(0, split)}
      <span className="umm-link-end">
        {children.slice(split)}
        <ExternalLink size={12} aria-hidden="true" />
      </span>
      <span className="policy-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * A measure's Table 6.1 rows, £ million by year, or what the documents give
 * where it has none. The years shorten on a phone ("26-27"); screen readers
 * always hear them in full.
 */
function Costing({ measure }) {
  if (!measure.costings.length) return measure.noCosting;
  return (
    <>
      <div className="umm-costing-scroll">
        <table className="umm-costing">
          <caption>£ million, Budget 2026 Table 6.1</caption>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {COSTING_YEARS.map((year) => (
                <th key={year} scope="col">
                  <span className="umm-year-full">{year}</span>
                  <span className="umm-year-short" aria-hidden="true">
                    {year.slice(2)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {measure.costings.map(({ row, values }) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {values.map((value, index) => (
                  <td key={COSTING_YEARS[index]}>{formatMillions(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {measure.costings
        .filter(({ note }) => note)
        .map(({ row, note }) => (
          <p key={row} className="umm-costing-note">
            {note}
          </p>
        ))}
    </>
  );
}

/**
 * One measure as a Policies card (PolicyCards.jsx's PolicyCard): its
 * category, name, At a glance (Starts, Ends, who it reaches and the
 * timeline), What changes (the entry's words, and the values before and
 * after where it gives them: utils/unmodelledCards.js), for a household,
 * then why it is left out, the Treasury costing, its sources and a link to
 * its Table 6.1 rows. The text is the entry's own.
 */
export function unmodelledCard(measure) {
  const layout = UNMODELLED_CARDS[measure.id] ?? {};
  const { parameters, ...card } = layout;
  const total = measure.costings.reduce((sum, { values }) => sum + values.reduce((a, b) => a + b, 0), 0);
  return {
    policy: {
      ...card,
      id: measure.id,
      anchorId: `unmodelled-${measure.id}`,
      name: measure.name,
      label: measure.name,
      starts: measure.starts,
      affects: measure.reaches,
      affectsWide: true,
      changesText: measure.changes,
      direction: total < 0 ? "cost" : total > 0 ? "revenue" : "neutral",
      example: { title: "For a household", text: measure.household },
      notModelled: measure.notModelled,
      budgetRows: measure.costings.map(({ row }) => row),
      sources: measure.sources,
      footExtra: (
        <div className="policy-card-modelling">
          <Disclosure
            compact
            title={
              <>
                <Landmark size={14} aria-hidden="true" className="policy-card-icon-inline" />
                Treasury costing
              </>
            }
            className="policy-card-details umm-costing-disclosure"
            preview={measure.costings.length ? `Table 6.1, £ million, ${COSTING_YEARS[0]} to ${COSTING_YEARS[COSTING_YEARS.length - 1]}` : "No Table 6.1 row"}
          >
            <div className="umm-costing-body">
              <Costing measure={measure} />
            </div>
          </Disclosure>
        </div>
      ),
    },
    parameters: parameters ?? null,
  };
}

/**
 * The Budget measures this dashboard does not model, under the modelled
 * cards on the Policies tab: a section like theirs, with its own heading
 * and subtitle, then one card per measure from utils/unmodelledMeasures.js,
 * with the government's own figures only.
 */
export default function UnmodelledMeasures({ measures = UNMODELLED_MEASURES }) {
  if (!measures.length) return null;
  return (
    <section id="budget-measures-not-modelled" className="umm" aria-label={UNMODELLED_TITLE}>
      <SectionHeading icon="list" title={UNMODELLED_TITLE} subtitle={UNMODELLED_SUBTITLE} />
      <div className="report-section policy-details-content">
        <p className="umm-intro">
          Below are Budget measures for households that this dashboard does not model, so its figures leave them
          out. Each entry says what changes, who it reaches, with the government's figures where it gives
          them, what it might mean for a household, and why the model leaves it out. Costings are the Treasury's,
          from Table 6.1 of the <SourceLink href={TABLE_6_1_URL}>Budget document</SourceLink>, in £ million: a
          positive figure is a gain to the Exchequer, a negative figure a cost.
        </p>
        <ul className="policy-cards umm-list">
          {measures.map((measure) => {
            const { policy, parameters } = unmodelledCard(measure);
            return <PolicyCard key={measure.id} policy={policy} parameters={parameters} />;
          })}
        </ul>
        {OTHER_MEASURES_NOTE && <p className="umm-note">{OTHER_MEASURES_NOTE}</p>}
      </div>
    </section>
  );
}

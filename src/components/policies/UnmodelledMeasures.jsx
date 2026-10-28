import { useId } from "react";
import { ArrowRightLeft, CalendarCheck, ExternalLink, FlaskConical, House, Landmark, Users } from "lucide-react";
import Disclosure from "../Disclosure";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
  OTHER_MEASURES_NOTE,
  TABLE_6_1_URL,
  UNMODELLED_MEASURES,
} from "../../utils/unmodelledMeasures";
import "./UnmodelledMeasures.css";

export const UNMODELLED_TITLE = "Budget measures this dashboard does not model";

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

function Fact({ icon: Icon, term, children }) {
  return (
    <div className="umm-fact">
      <dt>
        <Icon size={13} aria-hidden="true" />
        {term}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One measure: its name and start, then what changes, who it reaches, for a household, the costing, why it is left out, and its sources. */
function Measure({ measure }) {
  return (
    <li className="umm-item" id={`unmodelled-${measure.id}`}>
      <h3 className="umm-name">{measure.name}</h3>
      <p className="umm-starts">
        <CalendarCheck size={13} aria-hidden="true" />
        <span className="umm-starts-label">Starts</span> {measure.starts}
      </p>
      <dl className="umm-facts">
        <Fact icon={ArrowRightLeft} term="What changes">
          {measure.changes}
        </Fact>
        <Fact icon={Users} term="Who it reaches">
          {measure.reaches}
        </Fact>
        <Fact icon={House} term="For a household">
          {measure.household}
        </Fact>
        <Fact icon={Landmark} term="Treasury costing">
          <Costing measure={measure} />
        </Fact>
        <Fact icon={FlaskConical} term="Why it is not modelled">
          {measure.notModelled}
        </Fact>
      </dl>
      <p className="umm-sources">
        {measure.sources.length > 1 ? "Sources: " : "Source: "}
        {measure.sources.map((source, index) => (
          <span key={source.label}>
            {index > 0 && "; "}
            <SourceLink href={source.href}>{source.label}</SourceLink>
          </span>
        ))}
      </p>
    </li>
  );
}

/**
 * The Budget measures this dashboard does not model, at the foot of the
 * Policies tab: one disclosure, closed by default, in the page's own style
 * (Disclosure.jsx). Open, it lists each measure from
 * utils/unmodelledMeasures.js with the government's own figures only.
 */
export default function UnmodelledMeasures({ measures = UNMODELLED_MEASURES }) {
  const titleId = useId();
  if (!measures.length) return null;
  return (
    <section id="budget-measures-not-modelled" className="umm" aria-labelledby={titleId}>
      <Disclosure
        title={<span id={titleId}>{UNMODELLED_TITLE}</span>}
        preview={`${measures.length} measures · What changes · Who it reaches · For a household · Treasury costing`}
        className="umm-disclosure"
      >
        <p className="umm-intro">
          Below are Budget measures for households that this dashboard does not model, so its figures leave them
          out. Each entry says what changes, who it reaches, with the government's figures where it gives
          them, what it might mean for a household, and why the model leaves it out. Costings are the Treasury's,
          from Table 6.1 of the <SourceLink href={TABLE_6_1_URL}>Budget document</SourceLink>, in £ million: a
          positive figure is a gain to the Exchequer, a negative figure a cost.
        </p>
        <ul className="umm-list">
          {measures.map((measure) => (
            <Measure key={measure.id} measure={measure} />
          ))}
        </ul>
        {OTHER_MEASURES_NOTE && <p className="umm-note">{OTHER_MEASURES_NOTE}</p>}
      </Disclosure>
    </section>
  );
}

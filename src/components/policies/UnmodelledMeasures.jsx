import { useId, useState } from "react";
import { ChevronDown, ExternalLink, Landmark } from "lucide-react";
import TitleIcon from "../TitleIcon";
import { PolicyCard } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
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
  return (
    <>
      <div className="umm-costing-scroll">
        <table className="umm-costing">
          <caption>£ million, Budget 2026 Table 6.1; positive = gain to the Exchequer</caption>
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
      // The reason, then PolicyEngine's own work that models it, where there is some
      notModelled: measure.seeAlso ? (
        <>
          {measure.notModelled} {measure.seeAlso.before}
          <SourceLink href={measure.seeAlso.href}>{measure.seeAlso.label}</SourceLink>
          {measure.seeAlso.after}
        </>
      ) : (
        measure.notModelled
      ),
      sources: measure.sources,
      // PolicyEngine's post on it, in the footer as on the modelled cards
      explainer: measure.explainer,
      timeline: false,
      // The Treasury's six years on the card itself, or one muted line
      footExtra: (
        <section className="umm-costing-section" aria-label={`Treasury costing: ${measure.name}`}>
          <p className="policy-card-example-title">
            <Landmark size={14} aria-hidden="true" />
            Treasury costing
          </p>
          {measure.costings.length ? (
            <div className="umm-costing-body">
              <Costing measure={measure} />
            </div>
          ) : (
            <p className="umm-no-costing">No Table 6.1 row</p>
          )}
        </section>
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
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!measures.length) return null;
  const toggle = () => setOpen((value) => !value);
  return (
    <section id="budget-measures-not-modelled" className="umm" aria-label={UNMODELLED_TITLE}>
      {/* The section's heading, as "Policies we model" has it, opening and
          closing the cards: a native button in the h2, the subtitle under it */}
      <div id="budget-policies-we-do-not-model" className="section-heading has-icon umm-heading">
        <span className="section-icon" aria-hidden="true">
          <TitleIcon name="list" bare size={18} />
        </span>
        <div className="section-heading-text">
          <div className="section-heading-title">
            <h2>
              <button
                type="button"
                className="umm-toggle"
                aria-expanded={open}
                aria-controls={`${id}-cards`}
                aria-describedby={`${id}-subtitle`}
                onClick={toggle}
              >
                {UNMODELLED_TITLE}
                <ChevronDown className={`umm-chevron${open ? " is-open" : ""}`} size={22} aria-hidden="true" />
              </button>
            </h2>
          </div>
          {/* Clicking the subtitle opens it too; the button is the control */}
          <p id={`${id}-subtitle`} className="umm-subtitle" onClick={toggle}>
            {UNMODELLED_SUBTITLE}
          </p>
        </div>
      </div>
      <div id={`${id}-cards`} className="report-section policy-details-content" hidden={!open}>
        {open && (
          <ul className="policy-cards umm-list">
            {measures.map((measure) => {
              const { policy, parameters } = unmodelledCard(measure);
              return <PolicyCard key={measure.id} policy={policy} parameters={parameters} />;
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

import { useId, useState } from "react";
import { ChevronDown, ExternalLink, Landmark } from "lucide-react";
import TitleIcon from "../TitleIcon";
import Disclosure from "../Disclosure";
import { PolicyCard } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { UNMODELLED_VISUALS } from "../../utils/unmodelledVisuals";
import UnmodelledVisual from "./UnmodelledVisual";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
  TABLE_6_1_URL,
  UNMODELLED_MEASURES,
  UNMODELLED_REASONS,
} from "../../utils/unmodelledMeasures";
import "./UnmodelledMeasures.css";

export const UNMODELLED_TITLE = "Budget policies we do not model";
/** "row 15", or "rows 38 and 39". */
const rowsLabel = (rows) => (rows.length === 1 ? `row ${rows[0]}` : `rows ${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`);

export const COSTING_CAPTION = "Treasury costing, £m (Table 6.1; + is a gain to the Exchequer)";
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
          <caption>{COSTING_CAPTION}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="policy-sr-only">Row</span>
              </th>
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
                {/* Named only where there are several rows; screen readers always hear it */}
                <th scope="row" className={measure.costings.length > 1 ? undefined : "is-hidden"}>
                  Row {row}
                </th>
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
 * One measure as a Policies card (PolicyCards.jsx's PolicyCard), in the
 * modelled cards' own style, kept compact: the category and name, What
 * changes as the summary line, At a glance (Starts, Ends, who it reaches;
 * no timeline), the values before and after in the What changes block
 * where the entry gives them (no chart), For a household, then in the
 * footer one disclosure, Treasury costing, styled as About this result:
 * the Treasury's six years as a strip, the sources and the Table 6.1 rows. The words are the entry's own
 * (utils/unmodelledMeasures.js).
 */
export function unmodelledCard(measure) {
  const { parameters, ...layout } = UNMODELLED_CARDS[measure.id] ?? {};
  // A card's picture says what changes, so the values' tiles are not shown
  // as well (each fact once)
  const visual = UNMODELLED_VISUALS[measure.id] ? <UnmodelledVisual measure={measure} /> : null;
  const total = measure.costings.reduce((sum, { values }) => sum + values.reduce((x, y) => x + y, 0), 0);
  return {
    parameters: visual ? null : parameters ?? null,
    policy: {
      ...layout,
      visual,
      id: measure.id,
      anchorId: `unmodelled-${measure.id}`,
      name: measure.name,
      label: measure.name,
      summary: measure.changes,
      starts: measure.starts,
      affects: measure.reaches,
      affectsWide: true,
      timeline: false,
      direction: total < 0 ? "cost" : total > 0 ? "revenue" : "neutral",
      example: { title: "For a household", text: measure.household },
      // No "Why we don't model it": the section's title says so. The
      // reason stays in the data (measure.notModelled).
      footExtra: (
        <>
        {measure.heldBack && <p className="umm-held-back">{measure.heldBack}</p>}
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
            preview={[
              measure.costings.length ? `£m, ${COSTING_YEARS[0]} to ${COSTING_YEARS[COSTING_YEARS.length - 1]}` : "No Table 6.1 row",
              measure.sources.length > 1 ? "Sources" : "Source",
            ].join(" · ")}
          >
            <section className="umm-costing-section" aria-label={`Treasury costing: ${measure.name}`}>
              {measure.costings.length ? <Costing measure={measure} /> : <p className="umm-no-costing">No Table 6.1 row</p>}
              <p className="umm-sources">
                {measure.sources.length > 1 ? "Sources: " : "Source: "}
                {measure.sources.map((source, index) => (
                  <span key={source.label}>
                    {index > 0 && "; "}
                    <SourceLink href={source.href}>{source.label}</SourceLink>
                  </span>
                ))}
              </p>
              {measure.seeAlso && (
                <p className="umm-sources">
                  {measure.seeAlso.before}
                  <SourceLink href={measure.seeAlso.href}>{measure.seeAlso.label}</SourceLink>
                  {measure.seeAlso.after}
                </p>
              )}
              {measure.costings.length > 0 && (
                <p className="umm-sources">
                  Costing: <SourceLink href={TABLE_6_1_URL}>{`Budget 2026, Table 6.1, ${rowsLabel(measure.costings.map(({ row }) => row))}`}</SourceLink>
                </p>
              )}
            </section>
          </Disclosure>
        </div>
        </>
      ),
    },
  };
}


/** The measures in their data's order (`order`), so each row pairs cards of a like shape. */
export const byOrder = (measures) => [...measures].sort((x, y) => (x.order ?? Infinity) - (y.order ?? Infinity));

/**
 * The measures in their groups (UNMODELLED_REASONS: why we do not model
 * them), in order, each group in the data's order; a measure with no known
 * reason goes last, unlabelled. Empty groups are left out.
 */
export function groupsOf(measures) {
  const known = new Set(UNMODELLED_REASONS.map(({ id }) => id));
  const groups = UNMODELLED_REASONS.map(({ id, label, why }) => ({ id, label, why, items: byOrder(measures.filter((m) => m.reason === id)) }));
  groups.push({ id: "other", label: null, why: null, items: byOrder(measures.filter((m) => !known.has(m.reason))) });
  return groups.filter(({ items }) => items.length > 0);
}

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
        {/* One list of cards, two to a row, with no group titles (Vahid,
            29 Oct): the section's title and subtitle say why they are here */}
        {open && (
          <ul className="policy-cards umm-list">
            {groupsOf(measures)
              .flatMap(({ items }) => items)
              .map((measure) => {
                const { policy, parameters } = unmodelledCard(measure);
                return <PolicyCard key={measure.id} policy={policy} parameters={parameters} />;
              })}
          </ul>
        )}
      </div>
    </section>
  );
}

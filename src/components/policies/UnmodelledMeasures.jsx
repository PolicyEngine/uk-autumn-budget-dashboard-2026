import { useId, useState } from "react";
import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import TitleIcon from "../TitleIcon";
import { measureCategoryOf } from "../../utils/measureCategory";
import { differs, formatValue } from "../../utils/policyParameters";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
  UNMODELLED_GROUPS,
  UNMODELLED_MEASURES,
} from "../../utils/unmodelledMeasures";
import "./UnmodelledMeasures.css";

export const UNMODELLED_TITLE = "Budget policies we do not model";
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

/** "1 April 2027." → "1 April 2027", for the card's one meta line. */
const clause = (text) => String(text ?? "").trim().replace(/\.$/, "");

/**
 * A measure's values before and after, from its layout
 * (utils/unmodelledCards.js), or [] where the entry gives none: the main
 * one first, as the card's headline.
 */
export function headlineValues(measure) {
  const rows = UNMODELLED_CARDS[measure.id]?.parameters?.rows ?? [];
  return rows
    .map((row) => {
      const point = row.points.find(differs);
      return point ? { label: row.label, primary: row.primary, unit: row.unit, before: point.before, after: point.after } : null;
    })
    .filter(Boolean)
    .sort((x, y) => Number(y.primary) - Number(x.primary));
}

/**
 * One measure as a compact card: its category and name, what changes,
 * the values before and after as the headline, when and whom in one line,
 * for a household and why it is not in our figures in a line each, the
 * Treasury's six years as a strip, and its sources behind a disclosure.
 * The words are the entry's own (utils/unmodelledMeasures.js).
 */
function UnmodelledCard({ measure }) {
  const layout = UNMODELLED_CARDS[measure.id] ?? {};
  const category = measureCategoryOf({ category: layout.category, name: measure.name, id: measure.id });
  const values = headlineValues(measure);
  const [main, ...more] = values;
  const meta = [`From ${clause(measure.starts)}`, layout.ends ? `Ends ${layout.ends}` : "Continues", clause(measure.reaches)];
  return (
    <li className="umm-card" id={`unmodelled-${measure.id}`}>
      <div className="policy-card-topline">
        <p className="policy-card-type">
          <span className="mrl-icon" aria-hidden="true" style={{ "--mrl-colour": "var(--pe-gray-500)" }}>
            <TitleIcon name={category.icon} bare size={13} />
          </span>
          {category.label}
        </p>
      </div>
      <h3 className="umm-card-name">{measure.name}</h3>
      <p className="umm-card-changes">{measure.changes}</p>
      {main && (
        <div className="umm-headline">
          <p className="umm-headline-values" aria-label={`${main.label}: ${formatValue(main.before, main.unit)} becomes ${formatValue(main.after, main.unit)}`}>
            <span className="umm-before">{formatValue(main.before, main.unit)}</span>
            <ArrowRight size={18} aria-hidden="true" className="umm-arrow" />
            <span className="umm-after">{formatValue(main.after, main.unit)}</span>
          </p>
          <p className="umm-headline-label">
            {main.label}
            {more.map((row) => (
              <span key={row.label}>
                {" · "}
                {row.label}: {formatValue(row.before, row.unit)} → {formatValue(row.after, row.unit)}
              </span>
            ))}
          </p>
        </div>
      )}
      <p className="umm-meta">{meta.join(" · ")}</p>
      <dl className="umm-lines">
        <div>
          <dt>For a household:</dt>
          <dd>{measure.household}</dd>
        </div>
        <div>
          <dt>{WHY_LABEL}</dt>
          <dd>
            {measure.notModelled}
            {measure.seeAlso && (
              <>
                {" "}
                {measure.seeAlso.before}
                <SourceLink href={measure.seeAlso.href}>{measure.seeAlso.label}</SourceLink>
                {measure.seeAlso.after}
              </>
            )}
          </dd>
        </div>
      </dl>
      <section className="umm-costing-section" aria-label={`Treasury costing: ${measure.name}`}>
        {measure.costings.length ? (
          <Costing measure={measure} />
        ) : (
          <p className="umm-no-costing">
            <span className="umm-strip-label">Treasury costing</span> No Table 6.1 row
          </p>
        )}
      </section>
      <details className="umm-sources">
        <summary>{measure.sources.length > 1 ? "Sources" : "Source"}</summary>
        <ul>
          {measure.sources.map((source) => (
            <li key={source.label}>
              <SourceLink href={source.href}>{source.label}</SourceLink>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** The label of a card's reason, as one short line. */
export const WHY_LABEL = "Not in our figures because:";

/**
 * The measures in their groups (UNMODELLED_GROUPS), in order, each group
 * keeping the list's order; a measure with no known group goes last,
 * unlabelled.
 */
export function groupsOf(measures) {
  const known = new Set(UNMODELLED_GROUPS.map(({ id }) => id));
  const groups = UNMODELLED_GROUPS.map(({ id, label }) => ({ id, label, items: measures.filter((m) => m.group === id) }));
  groups.push({ id: "other", label: null, items: measures.filter((m) => !known.has(m.group)) });
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
        {open &&
          groupsOf(measures).map(({ id: group, label, items }) => (
            <div key={group} className="umm-group">
              {label && (
                <p className="umm-group-title" id={`${id}-${group}`}>
                  {label}
                </p>
              )}
              <ul className="umm-list" aria-labelledby={label ? `${id}-${group}` : undefined}>
                {items.map((measure) => (
                  <UnmodelledCard key={measure.id} measure={measure} />
                ))}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}

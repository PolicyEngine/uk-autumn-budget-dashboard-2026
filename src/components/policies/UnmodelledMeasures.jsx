import { useId, useState } from "react";
import { ChevronDown, ExternalLink, House, Landmark } from "lucide-react";
import TitleIcon from "../TitleIcon";
import SectionHeading from "../SectionHeading";
import Disclosure from "../Disclosure";
import { PolicyCard } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { EXTERNAL } from "../../utils/sources";
import {
  COSTING_YEARS,
  OBR_POLICY_TABLE,
  TABLE_6_1_URL,
  UNMODELLED_MEASURES,
  UNMODELLED_REASONS,
} from "../../utils/unmodelledMeasures";
import { HOUSEHOLD_ONLY_TITLE, householdOnlyLine, splitUnmodelled } from "../../utils/measureClass";
import "./UnmodelledMeasures.css";

export const UNMODELLED_TITLE = "Budget policies we do not model";
/** "row 15", or "rows 38 and 39". */
const rowsLabel = (rows) => (rows.length === 1 ? `row ${rows[0]}` : `rows ${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`);

export const COSTING_CAPTION = "Treasury costing, £m (Table 6.1; + is a gain to the Exchequer)";
// Where the entry gives the OBR's breakdown (`certified`): the government's
// costing as the OBR certifies it, by tax, then Table 6.1 as context
export const CERTIFIED_TITLE = "Government costing";
export const CERTIFIED_CAPTION = "The government's costing, certified by the OBR, £m (+ is a gain to the Exchequer)";
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
 * The rows the costing table shows: the OBR's breakdown by tax and its
 * total where the entry gives it (`certified`), else its Table 6.1 rows,
 * each named only where there are several.
 */
export function costingRows(measure) {
  if (measure.certified) {
    const { heads } = measure.certified;
    const total = COSTING_YEARS.map((_, index) => heads.reduce((sum, { values }) => sum + values[index], 0));
    return [...heads.map(({ head, values }) => ({ key: head, label: head, values })), { key: "total", label: "Total", values: total }];
  }
  const named = measure.costings.length > 1;
  return measure.costings.map(({ row, values }) => ({ key: row, label: `Row ${row}`, values, hidden: !named }));
}

/**
 * A measure's costing, £ million by year (costingRows), or what the
 * documents give where it has none. The years shorten on a phone
 * ("26-27"); screen readers always hear them in full.
 */
function Costing({ measure }) {
  return (
    <>
      <div className="umm-costing-scroll">
        <table className={`umm-costing${measure.certified ? " is-certified" : ""}`}>
          <caption>{measure.certified ? CERTIFIED_CAPTION : COSTING_CAPTION}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="policy-sr-only">{measure.certified ? "Tax" : "Row"}</span>
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
            {costingRows(measure).map(({ key, label, values, hidden }) => (
              <tr key={key} className={key === "total" ? "is-total" : undefined}>
                {/* Named only where there are several rows; screen readers always hear it */}
                <th scope="row" className={hidden ? "is-hidden" : undefined}>
                  {label}
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
 * (utils/unmodelledMeasures.js). `anchor` prefixes the card's id; `lead`
 * goes first in the footer (a household-only card's calculator link).
 */
export function unmodelledCard(measure, { anchor = "unmodelled", lead = null } = {}) {
  const { parameters, ...layout } = UNMODELLED_CARDS[measure.id] ?? {};
  const total = measure.costings.reduce((sum, { values }) => sum + values.reduce((x, y) => x + y, 0), 0);
  return {
    parameters: parameters ?? null,
    policy: {
      ...layout,
      id: measure.id,
      anchorId: `${anchor}-${measure.id}`,
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
        {lead}
        {measure.heldBack && <p className="umm-held-back">{measure.heldBack}</p>}
        <div className="policy-card-modelling">
          <Disclosure
            compact
            title={
              <>
                <Landmark size={14} aria-hidden="true" className="policy-card-icon-inline" />
                {measure.certified ? CERTIFIED_TITLE : "Treasury costing"}
              </>
            }
            className="policy-card-details umm-costing-disclosure"
            preview={[
              measure.costings.length ? `£m, ${COSTING_YEARS[0]} to ${COSTING_YEARS[COSTING_YEARS.length - 1]}` : "No Table 6.1 row",
              measure.sources.length > 1 ? "Sources" : "Source",
            ].join(" · ")}
          >
            <section className="umm-costing-section" aria-label={`${measure.certified ? CERTIFIED_TITLE : "Treasury costing"}: ${measure.name}`}>
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
              {measure.certified && (
                <p className="umm-sources">
                  Costing: <SourceLink href={OBR_POLICY_TABLE.href}>{`${OBR_POLICY_TABLE.label}, measure ${measure.certified.measure}`}</SourceLink>
                </p>
              )}
              {measure.costings.length > 0 &&
                (measure.certified ? (
                  // Table 6.1 as context: the same total, to the nearest £5m
                  // (UnmodelledMeasures.test.jsx holds it so)
                  <p className="umm-sources">
                    <SourceLink href={TABLE_6_1_URL}>{`Budget 2026, Table 6.1, ${rowsLabel(measure.costings.map(({ row }) => row))}`}</SourceLink>
                    {" "}gives the total to the nearest £5m.
                  </p>
                ) : (
                  <p className="umm-sources">
                    Costing: <SourceLink href={TABLE_6_1_URL}>{`Budget 2026, Table 6.1, ${rowsLabel(measure.costings.map(({ row }) => row))}`}</SourceLink>
                  </p>
                ))}
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

/**
 * "Budget policies we do not model": the not-modelled list without the
 * cards of the policies we model for households only (utils/measureClass.js),
 * which HouseholdOnlyMeasures shows. `published` is the catalogue's ids.
 */
export default function UnmodelledMeasures({ measures = UNMODELLED_MEASURES, published = [] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  measures = splitUnmodelled(measures, { published }).none;
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
        {/* A group per reason we do not model them: its title and why,
            then its cards, two to a row */}
        {open &&
          groupsOf(measures).map(({ id: group, label, why, items }) => (
            <div key={group} className="umm-group" data-reason={group}>
              {label && (
                <>
                  <p className="umm-group-title" id={`${id}-${group}`}>
                    {label}
                  </p>
                  <p className="umm-group-why" id={`${id}-${group}-why`}>
                    {why}
                  </p>
                </>
              )}
              <ul
                className="policy-cards umm-list"
                aria-labelledby={label ? `${id}-${group}` : undefined}
                aria-describedby={label ? `${id}-${group}-why` : undefined}
              >
                {items.map((measure) => {
                  const { policy, parameters } = unmodelledCard(measure);
                  return <PolicyCard key={measure.id} policy={policy} parameters={parameters} />;
                })}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * "Policies we model for households only" (utils/measureClass.js): the
 * Budget policies the Household calculator can add for one household
 * (utils/calculatorOnlyMeasures.js) that no national figure includes, as
 * the not-modelled cards are drawn, each with a link to the calculator.
 * Never a figure of ours: only the Treasury's costing. Nothing when there
 * are none, so the tab reads as it did before the class.
 */
export function HouseholdOnlyMeasures({ measures = UNMODELLED_MEASURES, published = [], onShowTab = null }) {
  const items = splitUnmodelled(measures, { published }).household;
  if (!items.length) return null;
  const line = householdOnlyLine(items.length);
  const openCalculator = (event) => {
    if (!onShowTab) return;
    event.preventDefault();
    onShowTab("household");
  };
  return (
    <section id="budget-measures-household-only" className="umm umm-household-only" aria-label={HOUSEHOLD_ONLY_TITLE}>
      <SectionHeading id="budget-policies-we-model-for-households-only" icon="house" title={HOUSEHOLD_ONLY_TITLE} subtitle={line} />
      <div className="report-section policy-details-content">
        <ul className="policy-cards umm-list" aria-label={HOUSEHOLD_ONLY_TITLE}>
          {items.map((measure) => {
            const { policy, parameters } = unmodelledCard(measure, {
              anchor: "household-only",
              lead: (
                <p className="umm-calculator">
                  <House size={14} aria-hidden="true" className="policy-card-icon-inline" />
                  <span>
                    Add it to a household in the{" "}
                    <a className="umm-link" href="?tab=household" onClick={openCalculator}>
                      Household calculator
                    </a>
                    , under the example households.
                  </span>
                </p>
              ),
            });
            return <PolicyCard key={measure.id} policy={policy} parameters={parameters} />;
          })}
        </ul>
      </div>
    </section>
  );
}

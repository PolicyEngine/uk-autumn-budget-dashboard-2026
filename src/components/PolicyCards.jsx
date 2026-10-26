import { useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { withPolicyDetails } from "../utils/policyDetails";
import { parameterTableFor } from "../utils/policyParameters";
import PolicyChange, { usePolicyParameters } from "./PolicyChange";
import TitleIcon from "./TitleIcon";
import ModellingFacts, { limitationCount } from "./ModellingFacts";
import { measureModellingFacts } from "../utils/measureModelling";

// Each group's heading and arrow, by the direction the catalogue gives a
// measure's budgetary effect. Cards carry no icon per measure: a map by
// measure id would be a measure list of the page's own.
export const GROUPS = [
  { heading: "Raises revenue", direction: "revenue", arrow: "arrowUp" },
  { heading: "Costs revenue", direction: "cost", arrow: "arrowDown" },
  { heading: "Other measures", direction: "neutral", arrow: null },
];

// The timeline runs over the charts' years: April 2026 to March 2032
// (2026-27 to 2031-32), month by month
export const TIMELINE_START_YEAR = 2026;
export const TIMELINE_YEARS = 6;
const TIMELINE_MONTHS = TIMELINE_YEARS * 12;
const TIMELINE_LABELS = Array.from({ length: TIMELINE_YEARS }, (_, i) => {
  const year = TIMELINE_START_YEAR + i;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
});

/** A "YYYY-MM" month as months since April of the timeline's first year. */
export function timelineMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return (year - TIMELINE_START_YEAR) * 12 + (number - 4);
}

/** The share of the timeline before `from`, and the share it covers. */
export function timelineSpan({ from, to }) {
  const start = clampMonth(timelineMonth(from));
  const end = to ? clampMonth(timelineMonth(to) + 1) : TIMELINE_MONTHS;
  return { left: start / TIMELINE_MONTHS, width: (end - start) / TIMELINE_MONTHS };
}

const clampMonth = (value) => Math.min(Math.max(value, 0), TIMELINE_MONTHS);
const share = (months) => `${(clampMonth(months) / TIMELINE_MONTHS) * 100}%`;

// Budget day, 28 October 2026, for orientation on every timeline
export const BUDGET_DAY_MONTH = timelineMonth("2026-10") + 27 / 31;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthName = (month) => {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[number - 1]} ${year}`;
};

/** How many months a temporary measure is in force, in words. */
export function durationLabel(policy) {
  if (policy.duration) return policy.duration;
  const { from, to } = policy.inForce;
  const months = timelineMonth(to) - timelineMonth(from) + 1;
  return months === 1 ? "1 month" : `${months} months`;
}

/** The timeline in words, for screen readers. */
export function timelineDescription(policy) {
  const { from, to } = policy.inForce;
  const steps = (policy.steps ?? [])
    .map((step) => `${step.label} in ${monthName(step.month)}`)
    .join(", ");
  let text = `In force from ${monthName(from)}`;
  if (to) text += ` to ${monthName(to)} (${durationLabel(policy).toLowerCase()})`;
  if (steps) text += `; ${steps}`;
  if (!to) text += "; no end date";
  return `${text}.`;
}

// The axis: a tick each month, a taller one each April
const AXIS_TICKS = Array.from({ length: TIMELINE_MONTHS + 1 }, (_, month) => month);

/**
 * When a measure is in force, on a small time axis from April 2026 to
 * March 2032: ticks for months and years, a line at Budget day, a dot where
 * the measure starts, and either an end dot with its length (a temporary
 * measure) or an arrowhead at the right edge (a lasting one). The span is
 * one solid line of one weight: no fades or thinner stretches, which would
 * read as a weaker measure. Steps within it, such as fuel duty's 5p coming
 * back in two stages, are small diamonds labelled below the axis. One
 * image, described in words for screen readers.
 */
function PolicyTimeline({ policy, highlight }) {
  const { from, to } = policy.inForce;
  const start = timelineMonth(from);
  const end = to ? timelineMonth(to) + 1 : TIMELINE_MONTHS;
  const steps = policy.steps ?? [];
  const stepLabel = steps.length ? policy.stepsLabel : null;
  const stepStart = steps.length ? timelineMonth(steps[0].month) : null;
  return (
    <div className="ptl" role="img" aria-label={timelineDescription(policy)}>
      <div className="ptl-plot">
        <div className="ptl-notes">
          <span className="ptl-budget-label" style={{ left: share(BUDGET_DAY_MONTH) }}>
            Budget
          </span>{" "}
          {!to && <span className="ptl-continues">Continues</span>}
        </div>
        <div className="ptl-track">
          <svg
            className="ptl-axis"
            viewBox={`0 0 ${TIMELINE_MONTHS} 12`}
            preserveAspectRatio="none"
            focusable="false"
          >
            <line className="is-base" x1="0" x2={TIMELINE_MONTHS} y1="6" y2="6" />
            {AXIS_TICKS.map((month) => {
              const year = month % 12 === 0;
              return (
                <line
                  key={month}
                  className={year ? "is-year" : undefined}
                  x1={month}
                  x2={month}
                  y1={year ? 0 : 4}
                  y2={year ? 12 : 8}
                />
              );
            })}
          </svg>
          {/* The years a hovered step of "What changes" covers */}
          {highlight && (
            <span
              className="ptl-year-band"
              style={{
                left: share((highlight.from - TIMELINE_START_YEAR) * 12),
                width: share((highlight.to - highlight.from + 1) * 12),
              }}
            />
          )}
          <span className="ptl-budget-line" style={{ left: share(BUDGET_DAY_MONTH) }} />
          <span
            className={`ptl-span${to ? "" : " is-lasting"}`}
            style={{ left: share(start), width: share(end - start) }}
          />
          <span className="ptl-dot" style={{ left: share(start) }} />
          {to && <span className="ptl-dot is-end" style={{ left: share(end) }} />}
          {steps.map((step) => (
            <span
              key={step.month}
              className="ptl-diamond"
              style={{ left: share(timelineMonth(step.month)) }}
            />
          ))}
          {!to && <span className="ptl-arrow" title="No end date" />}
        </div>
        {" "}
        {/* Always there, empty when unused, so the years line up across a row */}
        <div className="ptl-chips">
          {to && (
            <span className="ptl-chip" style={{ left: share(start) }}>
              {durationLabel(policy)}
            </span>
          )}
          {stepLabel && (
            <span className="ptl-step-label" style={{ left: share(stepStart) }}>
              {stepLabel}
            </span>
          )}
        </div>
      </div>
      <div className="policy-timeline-labels">
        {TIMELINE_LABELS.map((label, i) => (
          <span
            key={label}
            className={
              highlight && TIMELINE_START_YEAR + i >= highlight.from && TIMELINE_START_YEAR + i <= highlight.to
                ? "is-lit"
                : undefined
            }
          >
            <span className="policy-timeline-label-full">{label}</span>
            <span className="policy-timeline-label-short">{label.slice(2)}</span>{" "}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One measure's card. Every card has the same six rows, in the same order,
 * and the cards of a grid row share them (CSS subgrid), so each row lines
 * up across the cards: the head (type and any "Temporary" badge on one
 * line, then the name), the summary, what changes (the model's parameters,
 * current law beside the measure; the slot kept, empty, when the file has
 * no table for the measure as published), when it is in force (Starts and
 * Ends, the Ends slot kept even when empty, then the timeline), the
 * source, and the footer ("How it is modelled" and "See its effect" on
 * one line).
 */
function PolicyCard({ policy, onShowEffect, parameters }) {
  const temporary = Boolean(policy.inForce?.to);
  // The years a hovered step of "What changes" covers, marked on the timeline
  const [highlight, setHighlight] = useState(null);
  // What the published wording says about how it is modelled: fact and
  // limitation chips, and any modelling note
  const modelling = measureModellingFacts(policy, [policy.summary ?? policy.description, policy.details].filter(Boolean).join(" "));
  const hasModelling = Boolean(policy.details) || modelling.facts.length > 0 || modelling.limits.length > 0 || modelling.notePoints.length > 0;
  const limitations = limitationCount(modelling.limits);
  return (
    <li
      className="policy-card"
      style={{ "--policy-accent": policy.color }}
    >
      <div className="policy-card-head">
        {/* No icon per measure: a map by id would be a measure list of the
            page's own (#104) */}
        <div className="policy-card-titles">
          <div className="policy-card-topline">
            <p className="policy-card-type">{policy.type}</p>
            {temporary && <span className="policy-card-badge">Temporary</span>}
          </div>
          <h4 className="policy-card-name">{policy.label ?? policy.name}</h4>
        </div>
      </div>

      <p className="policy-card-summary">{policy.summary ?? policy.description}</p>

      <div className="policy-card-spec">
        {parameters && (
          <PolicyChange
            entry={parameters}
            direction={policy.direction}
            onHighlight={setHighlight}
          />
        )}
      </div>

      <div className="policy-card-when">
        <dl className="policy-card-dates">
          <div>
            <dt>Starts</dt>
            <dd className="policy-card-start">{policy.starts}</dd>
          </div>
          {/* The Ends slot stays, empty for a lasting measure, so the
              timeline sits at the same height in every card */}
          <div className="policy-card-ends" aria-hidden={temporary ? undefined : "true"}>
            {temporary && (
              <>
                <dt>Ends</dt>
                <dd className="policy-card-end">{policy.ends}</dd>
              </>
            )}
          </div>
        </dl>
        {policy.inForce && (
          <PolicyTimeline policy={policy} highlight={highlight} />
        )}
      </div>

      {/* The footer, one line: the source, how it is modelled, its effect */}
      <div className="policy-card-foot">
        {policy.source && (
          <a
            className="policy-card-source"
            href={policy.source.href}
            target="_blank"
            rel="noopener noreferrer"
            title={policy.source.label}
          >
            Source
            <span className="policy-sr-only">: {policy.source.label}</span>
            <ExternalLink size={14} aria-hidden="true" />
            <span className="policy-sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {hasModelling && (
          <details className="policy-card-details">
            <summary>
              How it is modelled
              {limitations && <span className="policy-card-limit-count">{limitations}</span>}
            </summary>
            {policy.details && <p>{policy.details}</p>}
            <ModellingFacts modelling={modelling} />
          </details>
        )}
        {onShowEffect && (
          <button
            type="button"
            className="policy-card-effect"
            onClick={() => onShowEffect(policy.id)}
            aria-label={`See the effect of ${policy.label ?? policy.name} on Population impact`}
          >
            See its effect
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The Policies view: a large card per published measure given, grouped by
 * the catalogue's direction (raises, costs, or no published costing), in
 * the catalogue's order; card text beyond the published name and
 * description comes from policyDetails.js where it has the id. Each card gives what
 * changes, what kind of measure it is, when it starts and ends (with a
 * timeline over the charts' years), how it is modelled and a source where
 * one exists, and what changes: the model's parameters before and after
 * (public/data/policy_parameters.json). Revenue figures stay in the charts: "See its effect" opens
 * Population impact with only that measure selected.
 */
function PolicyCards({ policies, selectedPolicies, onShowEffect, parameterTables }) {
  const tables = usePolicyParameters(parameterTables);
  return GROUPS.map(({ heading, direction, arrow }) => {
    const items = policies
      .filter((policy) =>
        policy.displayable === true && selectedPolicies.includes(policy.id) && policy.direction === direction,
      )
      .sort((a, b) => a.order - b.order)
      .map(withPolicyDetails);
    if (!items.length) return null;
    const headingId = `policy-group-${direction}`;
    return (
      <section
        key={heading}
        className={`policy-group is-${direction}`}
        aria-labelledby={headingId}
      >
        <div className="policy-group-head">
          <h3 id={headingId} className="policy-group-heading">
            {arrow && <TitleIcon name={arrow} bare size={16} className="policy-group-icon" />}
            {heading}
          </h3>
          <span className="policy-group-count">
            {items.length} {items.length === 1 ? "measure" : "measures"}
          </span>
        </div>
        <ul className="policy-cards">
          {items.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onShowEffect={onShowEffect}
              parameters={parameterTableFor(tables, policy)}
            />
          ))}
        </ul>
      </section>
    );
  });
}

export default PolicyCards;

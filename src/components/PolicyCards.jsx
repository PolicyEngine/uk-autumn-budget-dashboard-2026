import { useState } from "react";
import { CalendarCheck, CalendarX, ChartColumn, Clock, ExternalLink, Flag, FlaskConical } from "lucide-react";
import "./MeasureRowLabel.css";
import { measureCategoryOf } from "../utils/measureCategory";
import { withPolicyDetails } from "../utils/policyDetails";
import { parameterTableFor } from "../utils/policyParameters";
import PolicyChange, { usePolicyParameters } from "./PolicyChange";
import Disclosure from "./Disclosure";
import InfoSections, { hasInfo, infoPreview } from "./InfoSections";
import { MODELLING_LIMITS, measureModellingFacts, sentences } from "../utils/measureModelling";

/** The one name of every Policies card's disclosure. */
export const HOW_IT_IS_MODELLED = "About this result";

// A details sentence that states a limitation: one of the published
// limitations' patterns, or the words the details use for them
const LIMIT_WORDS = /\bapproximate\b|\bnot modelled\b|\bleaves? out\b|\bnot (?:included|identified)\b/i;
const isLimit = (sentence) => LIMIT_WORDS.test(sentence) || MODELLING_LIMITS.some(({ pattern }) => pattern.test(sentence));

/**
 * A measure's "About this result" (how it is modelled), in About this chart's sections: its
 * modelling details and fact labels as How it's calculated, and as Caveats
 * every stated limitation the card does not already show and any modelling
 * note. A limitation is said once: in the details' own words where they
 * state it, else in the published description's.
 */
export function modellingInfo(policy) {
  const modelling = measureModellingFacts(policy, [policy.summary ?? policy.description, policy.details].filter(Boolean).join(" "));
  const details = sentences(policy.details);
  return {
    how: [
      ...details.filter((sentence) => !isLimit(sentence)),
      modelling.facts.length > 0 && `Modelled with: ${modelling.facts.join(" · ")}.`,
    ],
    caveats: [
      ...details.filter(isLimit),
      ...modelling.limits.filter((limit) => !limit.said).map((limit) => limit.sentence),
      ...modelling.notePoints,
    ],
  };
}
import Tip from "./Tip";
import TitleIcon from "./TitleIcon";

// The cards' order by the catalogue's budgetary direction: measures that
// raise revenue, then those that cost it, then the rest. Cards carry no
// revenue tag or filter: one flat list.
const DIRECTION_ORDER = ["revenue", "cost", "neutral"];

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
            <Flag className="ptl-budget-icon" size={11} aria-hidden="true" />
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
          {!to && (
            <Tip content="No end date">
              <span className="ptl-arrow" />
            </Tip>
          )}
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
 * One measure's card: the head (type and any "Temporary" badge on one
 * line, then the name), the summary, what changes (the model's parameters,
 * current law beside the measure), when it is in force (Starts and Ends,
 * then the timeline), and the footer ("How it is modelled", then the
 * source and "See its effect").
 *
 * A measure without card details (no entry in policyDetails.js, or one
 * written for another description, as when a run publishes a changed
 * measure) shows its full published description and only the blocks it
 * has content for: no labelled box is ever drawn empty, and the card is
 * as tall as its content rather than its row (`is-bare`).
 */
function PolicyCard({ policy, onShowEffect, parameters }) {
  const temporary = Boolean(policy.inForce?.to);
  // Derived from the publication for any measure (utils/measureCategory.js),
  // in the same tinted tile as every per-measure row
  const category = measureCategoryOf(policy);
  // The years a hovered step of "What changes" covers, marked on the timeline
  const [highlight, setHighlight] = useState(null);
  // What the published wording says about how it is modelled
  const modelling = modellingInfo(policy);
  // No summary means no card details apply: the published description, in full
  const bare = !policy.summary;
  const showModelling = hasInfo(modelling);
  return (
    <li
      className={`policy-card${bare ? " is-bare" : ""}`}
      style={{ "--policy-accent": policy.color }}
    >
      <div className="policy-card-head">
        <div className="policy-card-titles">
          {(category || temporary) && (
            <div className="policy-card-topline">
              {category && (
                <p className="policy-card-type">
                  <span className="mrl-icon" aria-hidden="true" style={{ "--mrl-colour": policy.color }}>
                    <TitleIcon name={category.icon} bare size={13} />
                  </span>
                  {category.label}
                </p>
              )}
              <span className="policy-card-tags">
                {temporary && (
                  <span className="policy-card-badge">
                    <Clock size={12} aria-hidden="true" />
                    Temporary
                  </span>
                )}
              </span>
            </div>
          )}
          <h3 className="policy-card-name">{policy.label ?? policy.name}</h3>
        </div>
      </div>

      {bare ? (
        policy.description && <p className="policy-card-summary is-full">{policy.description}</p>
      ) : (
        <p className="policy-card-summary">{policy.summary}</p>
      )}

      {parameters && (
        <div className="policy-card-spec">
          <PolicyChange
            name={policy.label ?? policy.name}
            entry={parameters}
            direction={policy.direction}
            onHighlight={setHighlight}
          />
        </div>
      )}

      {(policy.starts || policy.inForce) && (
      <div className="policy-card-when">
        {policy.starts && (
        <dl className="policy-card-dates">
          <div>
            <dt>
              <CalendarCheck size={13} aria-hidden="true" />
              Starts
            </dt>
            <dd className="policy-card-start">{policy.starts}</dd>
          </div>
          {/* The Ends slot stays, empty for a lasting measure, so the
              timeline sits at the same height in every card */}
          <div className="policy-card-ends" aria-hidden={temporary ? undefined : "true"}>
            {temporary && (
              <>
                <dt>
                  <CalendarX size={13} aria-hidden="true" />
                  Ends
                </dt>
                <dd className="policy-card-end">{policy.ends}</dd>
              </>
            )}
          </div>
        </dl>
        )}
        {policy.inForce && (
          <PolicyTimeline policy={policy} highlight={highlight} />
        )}
      </div>
      )}

      {/* The footer: how it is modelled across the card, then the source on
          the left and its effect on the right */}
      <div className="policy-card-foot">
        {showModelling && (
        <div className="policy-card-modelling">
            <Disclosure
              compact
              title={
                <>
                  <FlaskConical size={14} aria-hidden="true" className="policy-card-icon-inline" />
                  {HOW_IT_IS_MODELLED}
                </>
              }
              className="policy-card-details"
              preview={infoPreview(modelling)}
            >
              <InfoSections info={modelling} />
            </Disclosure>
        </div>
        )}
        <div className="policy-card-actions">
          {policy.source && (
            <Tip content={policy.source.label}>
            <a
              className="policy-card-source"
              href={policy.source.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              Source
              <span className="policy-sr-only">: {policy.source.label}</span>
              <ExternalLink size={14} aria-hidden="true" />
              <span className="policy-sr-only"> (opens in a new tab)</span>
            </a>
            </Tip>
          )}
          {onShowEffect && (
            <button
              type="button"
              className="policy-card-effect"
              onClick={() => onShowEffect(policy.id)}
              aria-label={`See its effect: ${policy.label ?? policy.name}, on Population impact`}
            >
              <ChartColumn size={16} aria-hidden="true" />
              See its effect
            </button>
          )}
        </div>
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
  const shown = policies.filter((policy) => policy.displayable === true && selectedPolicies.includes(policy.id));
  // Raises first, then costs, then the rest, each in the catalogue's order
  const rank = (policy) => {
    const index = DIRECTION_ORDER.indexOf(policy.direction);
    return index < 0 ? DIRECTION_ORDER.length : index;
  };
  const items = shown
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
    .map(withPolicyDetails);
  if (!shown.length) return null;
  return (
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
  );
}

export default PolicyCards;

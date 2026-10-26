import { ArrowRight, ExternalLink } from "lucide-react";
import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
  POLICY_ICONS,
  REVENUE_RAISING_NAMES,
} from "../utils/policyConfig";
import TitleIcon from "./TitleIcon";

const GROUPS = [
  { heading: "Raises revenue", raises: true, arrow: "arrowUp" },
  { heading: "Costs revenue", raises: false, arrow: "arrowDown" },
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
 * measure) or a fade and an arrow off the right edge (a lasting one). Steps
 * within it, such as fuel duty coming back in two stages, are diamonds,
 * labelled below the axis; after the last step the remaining effect is
 * drawn thinner. One image, described
 * in words for screen readers.
 */
function PolicyTimeline({ policy }) {
  const { from, to } = policy.inForce;
  const start = timelineMonth(from);
  const end = to ? timelineMonth(to) + 1 : TIMELINE_MONTHS;
  const steps = policy.steps ?? [];
  // A lasting measure with steps: full strength until its last step, then a
  // thinner tail for what remains
  const fullEnd = !to && steps.length ? timelineMonth(steps[steps.length - 1].month) : end;
  const stepLabel = steps.length ? policy.stepsLabel : null;
  const stepStart = steps.length ? timelineMonth(steps[0].month) : null;
  return (
    <div className="ptl" role="img" aria-label={timelineDescription(policy)}>
      <div className="ptl-plot">
        <div className="ptl-notes">
          <span className="ptl-budget-label" style={{ left: share(BUDGET_DAY_MONTH) }}>
            Budget
          </span>
          {!to && <span className="ptl-continues">Continues</span>}
        </div>
        <div className="ptl-track">
          <svg
            className="ptl-axis"
            viewBox={`0 0 ${TIMELINE_MONTHS} 12`}
            preserveAspectRatio="none"
            focusable="false"
          >
            <line x1="0" x2={TIMELINE_MONTHS} y1="6" y2="6" />
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
          <span className="ptl-budget-line" style={{ left: share(BUDGET_DAY_MONTH) }} />
          <span
            className={`ptl-span${!to && !steps.length ? " is-lasting" : ""}`}
            style={{ left: share(start), width: share(fullEnd - start) }}
          />
          {!to && steps.length > 0 && (
            <span
              className="ptl-tail is-lasting"
              style={{ left: share(fullEnd), width: share(TIMELINE_MONTHS - fullEnd) }}
            />
          )}
          <span className="ptl-dot" style={{ left: share(start) }} />
          {to && <span className="ptl-dot is-end" style={{ left: share(end) }} />}
          {steps.map((step) => (
            <span
              key={step.month}
              className="ptl-diamond"
              style={{ left: share(timelineMonth(step.month)) }}
            />
          ))}
          {!to && <span className="ptl-arrow" />}
        </div>
        {(to || stepLabel) && (
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
        )}
      </div>
      <div className="policy-timeline-labels">
        {TIMELINE_LABELS.map((label) => (
          <span key={label}>
            <span className="policy-timeline-label-full">{label}</span>
            <span className="policy-timeline-label-short">{label.slice(2)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PolicyCard({ policy, onShowEffect }) {
  const temporary = Boolean(policy.inForce?.to);
  return (
    <li
      className="policy-card"
      style={{ "--policy-accent": POLICY_COLORS[policy.name] }}
    >
      <div className="policy-card-head">
        <span className="policy-card-icon">
          <TitleIcon name={POLICY_ICONS[policy.id]} bare size={22} />
        </span>
        <div className="policy-card-titles">
          <p className="policy-card-type">{policy.type}</p>
          <h4 className="policy-card-name">{policy.name}</h4>
        </div>
        {temporary && <span className="policy-card-badge">Temporary</span>}
      </div>

      <p className="policy-card-summary">{policy.summary}</p>

      <div className="policy-card-when">
        <dl className="policy-card-dates">
          <div>
            <dt>Starts</dt>
            <dd className="policy-card-start">{policy.starts}</dd>
          </div>
          {temporary && (
            <div>
              <dt>Ends</dt>
              <dd className="policy-card-end">{policy.ends}</dd>
            </div>
          )}
        </dl>
        {policy.inForce && <PolicyTimeline policy={policy} />}
      </div>

      <div className="policy-card-foot">
        {policy.details && (
          <details className="policy-card-details">
            <summary>How it is modelled</summary>
            <p>{policy.details}</p>
          </details>
        )}
        <div className="policy-card-actions">
          {policy.source && (
            <a
              className="policy-card-source"
              href={policy.source.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Source: {policy.source.label}</span>
              <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {onShowEffect && (
            <button
              type="button"
              className="policy-card-effect"
              onClick={() => onShowEffect(policy.id)}
              aria-label={`See the effect of ${policy.name} on Population impact`}
            >
              See its effect
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The Policies view: a large card per policy given, grouped by whether it
 * raises or costs revenue, in the legends' order. Each card gives what
 * changes, what kind of measure it is, when it starts and ends (with a
 * timeline over the charts' years), how it is modelled and a source where
 * one exists. Revenue figures stay in the charts: "See its effect" opens
 * Population impact with only that measure selected.
 */
function PolicyCards({ policies, selectedPolicies, onShowEffect }) {
  return GROUPS.map(({ heading, raises, arrow }) => {
    const items = ALL_POLICY_NAMES.map((name) =>
      policies.find((policy) => policy.name === name),
    ).filter(
      (policy) =>
        policy &&
        selectedPolicies.includes(policy.id) &&
        REVENUE_RAISING_NAMES.has(policy.name) === raises,
    );
    if (!items.length) return null;
    const headingId = `policy-group-${raises ? "raises" : "costs"}`;
    return (
      <section
        key={heading}
        className={`policy-group ${raises ? "is-raises" : "is-costs"}`}
        aria-labelledby={headingId}
      >
        <div className="policy-group-head">
          <h3 id={headingId} className="policy-group-heading">
            <TitleIcon name={arrow} bare size={16} className="policy-group-icon" />
            {heading}
          </h3>
          <span className="policy-group-count">
            {items.length} {items.length === 1 ? "measure" : "measures"}
          </span>
        </div>
        <ul className="policy-cards">
          {items.map((policy) => (
            <PolicyCard key={policy.id} policy={policy} onShowEffect={onShowEffect} />
          ))}
        </ul>
      </section>
    );
  });
}

export default PolicyCards;

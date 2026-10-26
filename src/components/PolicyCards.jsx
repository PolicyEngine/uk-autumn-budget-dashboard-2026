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
// (2026-27 to 2031-32), one segment a year, month by month
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
  const clamp = (value) => Math.min(Math.max(value, 0), TIMELINE_MONTHS);
  const start = clamp(timelineMonth(from));
  const end = to ? clamp(timelineMonth(to) + 1) : TIMELINE_MONTHS;
  return { left: start / TIMELINE_MONTHS, width: (end - start) / TIMELINE_MONTHS };
}

/**
 * When a measure is in force, drawn on a bar of years. Decorative: the
 * card states the start and end in words beside it.
 */
function PolicyTimeline({ inForce, temporary }) {
  const { left, width } = timelineSpan(inForce);
  return (
    <div className="policy-timeline" aria-hidden="true">
      <div className="policy-timeline-track">
        {TIMELINE_LABELS.map((label) => (
          <span key={label} className="policy-timeline-year" />
        ))}
        <span
          className={`policy-timeline-bar${temporary ? " is-temporary" : " is-lasting"}`}
          style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
        />
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
          <div>
            <dt>Ends</dt>
            <dd className="policy-card-end">{temporary ? policy.ends : "No end date"}</dd>
          </div>
        </dl>
        {policy.inForce && <PolicyTimeline inForce={policy.inForce} temporary={temporary} />}
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

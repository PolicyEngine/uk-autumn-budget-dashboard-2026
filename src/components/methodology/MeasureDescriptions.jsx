import { useId, useState } from "react";
import { ArrowRight, ChevronDown, CircleSlash, TriangleAlert } from "lucide-react";
import { GROUPS } from "../PolicyCards";
import { fiscalYearTick } from "../../utils/chartTheme";
import { usualFirstYear } from "./measures";

/** The id of a measure's card on the Policies tab, for links to it. */
export const policyCardId = (id) => `policy-card-${id}`;

/**
 * A limitation chip: a button that opens to the sentence of the published
 * description it comes from, so the caveat is one click from the row, not
 * behind the full text.
 */
function LimitChip({ limit, open, onToggle, controls }) {
  return (
    <button
      type="button"
      className="method-tag method-tag-warning mm-limit-chip"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
      {limit.label}
    </button>
  );
}

/**
 * One measure: its name (the toggle), a one-line summary and chips for its
 * modelling facts, then, when opened, the full published description and
 * any modelling note as bullets, with links to its Policies card and its
 * effect.
 */
function MeasureRow({ measure, color, showFrom, onShowTab, onShowEffect }) {
  const [open, setOpen] = useState(false);
  const [openLimits, setOpenLimits] = useState([]);
  const id = useId();
  const bodyId = `${id}-body`;
  const toggleLimit = (index) =>
    setOpenLimits((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
    );
  const hasChips = measure.facts.length > 0 || measure.limits.length > 0 || showFrom;
  return (
    <li className="mm-item" style={{ "--mm-accent": color }}>
      <button
        type="button"
        className="mm-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="method-swatch" aria-hidden="true" />
        <span className="mm-name">{measure.name}</span>
        <ChevronDown className="mm-chevron" aria-hidden="true" strokeWidth={1.75} />
      </button>
      <p className="mm-summary">{measure.summary}</p>
      {hasChips && (
        <div className="mm-chips">
          {showFrom && (
            <span className="method-tag method-tag-teal">
              Results from {measure.from === null ? "unavailable" : fiscalYearTick(measure.from)}
            </span>
          )}
          {measure.facts.map((fact) => (
            <span key={fact} className="method-tag">
              {fact}
            </span>
          ))}
          {measure.limits.map((limit, index) => (
            <LimitChip
              key={limit.sentence}
              limit={limit}
              open={openLimits.includes(index)}
              controls={`${id}-limit-${index}`}
              onToggle={() => toggleLimit(index)}
            />
          ))}
        </div>
      )}
      {measure.limits.map((limit, index) => (
        <p
          key={limit.sentence}
          id={`${id}-limit-${index}`}
          className="mm-limit"
          hidden={!openLimits.includes(index)}
        >
          {limit.sentence}
        </p>
      ))}
      <div id={bodyId} className="mm-body" hidden={!open}>
        <p className="mm-label">Published description</p>
        <ul className="mm-points">
          {measure.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {measure.notePoints.length > 0 && (
          <div className="mm-note">
            <p className="mm-label">Modelling note</p>
            <ul className="mm-points">
              {measure.notePoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mm-links">
          <a
            href={`?tab=policies#${policyCardId(measure.id)}`}
            onClick={(event) => {
              event.preventDefault();
              onShowTab("policies");
              setTimeout(() => {
                document.getElementById(policyCardId(measure.id))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
              }, 100);
            }}
          >
            What it does
            <ArrowRight aria-hidden="true" strokeWidth={1.75} />
          </a>
          {onShowEffect && (
            <button
              type="button"
              className="mm-effect"
              onClick={() => onShowEffect(measure.id)}
              aria-label={`See the effect of ${measure.name} on Population impact`}
            >
              See its effect
              <ArrowRight aria-hidden="true" strokeWidth={1.75} />
            </button>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * The published measure descriptions, grouped as the Policies tab groups
 * its cards, each a compact row that opens to the full text. Names,
 * descriptions and chips all come from the catalogue's published text.
 */
export function MeasureDescriptions({ measures, colors, onShowTab, onShowEffect }) {
  const usual = usualFirstYear(measures);
  return GROUPS.map(({ heading, direction }) => {
    const items = measures.filter((measure) => measure.direction === direction).sort((a, b) => a.order - b.order);
    if (!items.length) return null;
    const headingId = `mm-group-${direction}`;
    return (
      <section key={direction} className={`mm-group is-${direction}`} aria-labelledby={headingId}>
        <h4 id={headingId} className="mm-group-heading">
          {heading}
          <span className="mm-group-count">
            {items.length} {items.length === 1 ? "measure" : "measures"}
          </span>
        </h4>
        <ul className="mm-list">
          {items.map((measure) => (
            <MeasureRow
              key={measure.id}
              measure={measure}
              color={colors[measure.seriesKey]}
              showFrom={measure.from !== usual}
              onShowTab={onShowTab}
              onShowEffect={onShowEffect}
            />
          ))}
        </ul>
      </section>
    );
  });
}

/** A compact list of measures and a reason each, for "Unavailable" and "Not modelled". */
export function ReasonList({ items, icon = false }) {
  return (
    <ul className="mm-reasons">
      {items.map((item) => (
        <li key={item.name}>
          <span className="mm-reason-name">
            {icon && <CircleSlash className="method-row-icon" aria-hidden="true" strokeWidth={1.75} />}
            {item.name}
          </span>
          <span className="mm-reason-why">{item.why}</span>
        </li>
      ))}
    </ul>
  );
}

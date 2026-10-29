import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowRightLeft, Baby } from "lucide-react";
import { UNMODELLED_VISUALS } from "../../utils/unmodelledVisuals";
import "./UnmodelledVisual.css";

/**
 * "What changes" on a card in "Budget policies we do not model": one small
 * picture per measure (utils/unmodelledVisuals.js), drawn in HTML and CSS
 * where it is bars and boxes, and in SVG at the card's own width where it
 * is a line. No motion. Colours are the dashboard's tokens: grey for what
 * stays as it was, teal for a gain, amber for paying more. The whole
 * picture is one image to a screen reader, named by its `alt` sentence.
 */

const pct = (value, max) => `${(100 * value) / max}%`;

/** The width of an element, followed as it changes. */
function useWidth(ref, initial = 320) {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Horizontal bars from zero, each a grey part (as it was) and the change in the tone. */
function Bars({ spec }) {
  return (
    <div className="umv-bars">
      {spec.rows.map((row) => {
        const tone = row.plain ? "before" : row.tone ?? spec.tone;
        return (
          <div className="umv-bar-row" key={row.label}>
            <span className="umv-label">{row.label}</span>
            <span className="umv-track">
              {row.base !== undefined && <span className="umv-fill is-before" style={{ left: 0, width: pct(row.base, spec.max) }} />}
              <span
                className={`umv-fill is-${tone}${row.dashed ? " is-dashed" : ""}`}
                style={{ left: pct(row.base ?? 0, spec.max), width: pct(row.value - (row.base ?? 0), spec.max) }}
              />
              {row.ghost && (
                <span className="umv-ghost" style={{ left: pct(row.value, spec.max), width: pct(row.ghost.to - row.value, spec.max) }} />
              )}
            </span>
            <span className={`umv-value is-${tone}`}>
              {row.text}
              {row.ghost && <span className="umv-ghost-text">{row.ghost.text}</span>}
            </span>
          </div>
        );
      })}
      {(spec.key || spec.cap) && (
        <p className="umv-key">
          {spec.key && (
            <>
              <span className="umv-key-item">
                <span className="umv-swatch is-before" />
                {spec.key.base}
              </span>
              <span className="umv-key-item">
                <span className={`umv-swatch is-${spec.tone}`} />
                {spec.key.add}
              </span>
            </>
          )}
          {spec.cap && <span>{spec.cap}</span>}
        </p>
      )}
    </div>
  );
}

const COLUMN_HEIGHT = 62;

/** Columns from a shared baseline, the value on top and the period under. */
function Columns({ spec }) {
  const max = Math.max(...spec.columns.map(({ value }) => value));
  return (
    <div className="umv-columns">
      {spec.columns.map((column) => (
        <div className="umv-column" key={column.label}>
          <span className="umv-column-area">
            <span className={`umv-column-value is-${column.tone ?? "before"}`}>{column.text}</span>
            <span className={`umv-column-bar is-${column.tone ?? "before"}`} style={{ height: `${Math.round((COLUMN_HEIGHT * column.value) / max)}px` }} />
          </span>
          <span className="umv-label">{column.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A bill as one bar, the relief a share of it and the rest paid. */
function Bill({ spec }) {
  return (
    <div className="umv-bars">
      {spec.rows.map((row) => (
        <div className="umv-bar-row is-bill" key={row.label}>
          <span className="umv-label">{row.label}</span>
          <span className="umv-track is-whole">
            <span className={`umv-fill is-${row.tone ?? "before"}`} style={{ left: 0, width: `${row.relief}%` }} />
            <span className="umv-in-bar" style={{ left: `calc(${row.relief}% + 6px)` }}>
              <strong>{row.relief}%</strong> relief
            </span>
          </span>
        </div>
      ))}
      <p className="umv-key">
        <span className="umv-key-item">
          <span className="umv-swatch is-whole" />
          The rest of the bill is paid
        </span>
      </p>
    </div>
  );
}

/** Rules into one result: the highest of them. */
function Highest({ spec }) {
  return (
    <div className="umv-highest">
      <ul className="umv-inputs">
        {spec.inputs.map((input) => (
          <li key={input.label} className={`umv-input${input.tone ? ` is-${input.tone}` : ""}`}>
            <span>{input.label}</span>
            {input.was && <span className="umv-was">{input.was}</span>}
          </li>
        ))}
      </ul>
      <span className="umv-arrow" aria-hidden="true">
        <ArrowRight size={18} />
      </span>
      <p className="umv-result">{spec.result}</p>
    </div>
  );
}

/** Who pays whom, one lane a period, the arrows between. */
function Flow({ spec }) {
  return (
    <div className="umv-flow">
      {spec.lanes.map((lane) => (
        <div className="umv-lane" key={lane.label}>
          <span className="umv-label">{lane.label}</span>
          <span className="umv-steps">
            {lane.steps.map((step, index) => (
              <span className="umv-step-wrap" key={step}>
                {index > 0 && <ArrowRight size={14} className={`umv-flow-arrow is-${lane.tone ?? "before"}`} />}
                <span className={`umv-step is-${lane.tone ?? "before"}${step === "HMRC" ? " is-end" : ""}`}>{step}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One price as parts in a row, each named under it. */
function Stack({ spec }) {
  const named = spec.parts.filter(({ share }) => share !== null).reduce((sum, { share }) => sum + share, 0);
  return (
    <div className="umv-stack">
      <span className={`umv-stack-bar${spec.tall ? " is-tall" : ""}`}>
        {spec.parts.map((part) => (
          <span
            key={part.label}
            className={`umv-part is-${part.tone ?? "before"}`}
            style={{ width: `${part.share ?? 100 - named}%` }}
          />
        ))}
      </span>
      <ul className="umv-parts">
        {spec.parts.map((part) => (
          <li key={part.label}>
            <span className={`umv-swatch is-${part.tone ?? "before"}`} />
            {part.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A lifetime's gains along one axis, each row its bands. */
function Bands({ spec }) {
  return (
    <div className="umv-bands">
      {spec.rows.map((row) => (
        <div className="umv-bar-row is-bands" key={row.label}>
          <span className="umv-label">{row.label}</span>
          <span className="umv-band-track">
            {row.bands.map((band) => (
              <span key={band.text} className={`umv-band is-${band.tone ?? "before"}`} style={{ width: `${band.share}%` }}>
                {band.text}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="umv-bar-row is-bands is-ticks">
        <span className="umv-label" />
        <span className="umv-ticks">
          <span style={{ left: "50%" }}>{spec.ticks[0]}</span>
          <span style={{ left: "100%" }}>{spec.ticks[1]}</span>
        </span>
      </div>
    </div>
  );
}

/** A birth, then the weeks paid. */
function Weeks({ spec }) {
  return (
    <div className="umv-weeks">
      <span className="umv-birth">
        <Baby size={18} aria-hidden="true" />
        Birth
      </span>
      {spec.weeks.map((week) => (
        <span className="umv-week" key={week}>
          <span className="umv-week-name">{week}</span>
          <strong>{spec.amount}</strong>
        </span>
      ))}
    </div>
  );
}

const PLOT = { top: 16, bottom: 20, left: 8, right: 8 };

/** A rate over the months: as it was dashed, the measure's step in the tone. */
function Timeline({ spec }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const height = 88;
  const x0 = PLOT.left;
  const x1 = width - PLOT.right;
  const at = (share) => x0 + share * (x1 - x0);
  const y = (rate) => height - PLOT.bottom - (rate / (spec.after * 1.25)) * (height - PLOT.top - PLOT.bottom);
  // Oct 2026 to Sep 2028: the step from Jan 2027 to the end of Mar 2028
  const start = 3 / 24;
  const end = 18 / 24;
  return (
    <div className="umv-plot" ref={wrap}>
      <svg width={width} height={height} aria-hidden="true">
        <line className="umv-axis" x1={x0} x2={x1} y1={height - PLOT.bottom} y2={height - PLOT.bottom} />
        <rect className={`umv-area is-${spec.tone}`} x={at(start)} width={at(end) - at(start)} y={y(spec.after)} height={y(spec.before) - y(spec.after)} />
        <path className="umv-line is-before" d={`M${x0},${y(spec.before)}H${x1}`} />
        <path
          className={`umv-line is-${spec.tone}`}
          d={`M${x0},${y(spec.before)}H${at(start)}V${y(spec.after)}H${at(end)}V${y(spec.before)}H${x1}`}
        />
        <text className="umv-svg-value" x={x0} y={y(spec.before) - 6}>{`${spec.before}%`}</text>
        <text className={`umv-svg-value is-${spec.tone}`} x={(at(start) + at(end)) / 2} y={y(spec.after) - 6} textAnchor="middle">
          {`${spec.after}% for ${spec.span}`}
        </text>
        <text className="umv-svg-tick" x={at(start)} y={height - 6} textAnchor="middle">{spec.from.label}</text>
        <text className="umv-svg-tick" x={at(end)} y={height - 6} textAnchor="middle">{spec.to.label}</text>
      </svg>
    </div>
  );
}

/** Pence a mile by business miles in the year: one rate to the threshold, another above it. */
function Mileage({ spec }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const height = 88;
  const x0 = PLOT.left;
  const x1 = width - PLOT.right;
  const split = x0 + 0.58 * (x1 - x0);
  const y = (pence) => height - PLOT.bottom - (pence / (spec.first * 1.25)) * (height - PLOT.top - PLOT.bottom);
  const { before, after } = spec.above;
  return (
    <div className="umv-plot" ref={wrap}>
      <svg width={width} height={height} aria-hidden="true">
        <line className="umv-axis" x1={x0} x2={x1} y1={height - PLOT.bottom} y2={height - PLOT.bottom} />
        <line className="umv-grid" x1={split} x2={split} y1={PLOT.top - 6} y2={height - PLOT.bottom} />
        <rect className={`umv-area is-${spec.tone}`} x={split} width={x1 - split} y={y(after)} height={y(before) - y(after)} />
        <path className="umv-line is-before" d={`M${split},${y(before)}H${x1}`} />
        <path className={`umv-line is-${spec.tone}`} d={`M${x0},${y(spec.first)}H${split}V${y(after)}H${x1}`} />
        <text className={`umv-svg-value is-${spec.tone}`} x={(x0 + split) / 2} y={y(spec.first) - 6} textAnchor="middle">{`${spec.first}p, made permanent`}</text>
        <text className={`umv-svg-value is-${spec.tone}`} x={x1} y={y(after) - 6} textAnchor="end">{`${after}p`}</text>
        <text className="umv-svg-value" x={x1} y={y(before) + 14} textAnchor="end">{`was ${before}p`}</text>
        <text className="umv-svg-tick" x={split} y={height - 6} textAnchor="middle">{spec.threshold.label}</text>
      </svg>
    </div>
  );
}

/** A year's bill against gas used: with the standing charge, and without it, with dearer units. */
function Standing({ spec }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const height = 116;
  const x0 = PLOT.left + 2;
  const x1 = width - PLOT.right;
  const base = height - PLOT.bottom;
  const top = PLOT.top + 4;
  // Schematic, not to scale: the bill with the charge starts at the charge
  // and rises slowly; without it, it starts at nothing and rises faster,
  // crossing at `cross` of the axis
  const cross = 0.5;
  const atX = (share) => x0 + share * (x1 - x0);
  const charge = base - (base - top) * 0.45;
  const beforeEnd = charge - (base - top) * 0.2;
  const crossY = charge + (beforeEnd - charge) * cross;
  const afterEnd = base + (crossY - base) / cross;
  return (
    <div className="umv-plot" ref={wrap}>
      <svg width={width} height={height} aria-hidden="true">
        <path className="umv-area is-gain" d={`M${x0},${charge}L${atX(cross)},${crossY}L${x0},${base}Z`} />
        <path className="umv-area is-loss" d={`M${atX(cross)},${crossY}L${x1},${beforeEnd}L${x1},${afterEnd}Z`} />
        <line className="umv-axis" x1={x0} x2={x1} y1={base} y2={base} />
        <line className="umv-axis" x1={x0} x2={x0} y1={top - 8} y2={base} />
        <path className="umv-line is-before" d={`M${x0},${charge}L${x1},${beforeEnd}`} />
        <path className="umv-line is-ink" d={`M${x0},${base}L${x1},${afterEnd}`} />
        <text className="umv-svg-value" x={x0 + 6} y={charge - 13}>{spec.charge}</text>
        <text className="umv-svg-value is-gain" x={atX(cross / 2)} y={height - 6} textAnchor="middle">{spec.light}</text>
        <text className="umv-svg-value is-loss" x={atX((1 + cross) / 2)} y={height - 6} textAnchor="middle">{spec.heavy}</text>
      </svg>
      <p className="umv-key">
        <span className="umv-key-item">
          <span className="umv-swatch is-before is-line" />
          With the standing charge
        </span>
        <span className="umv-key-item">
          <span className="umv-swatch is-ink is-line" />
          Without it, dearer units
        </span>
      </p>
    </div>
  );
}

const KINDS = {
  bars: Bars,
  columns: Columns,
  bill: Bill,
  highest: Highest,
  flow: Flow,
  stack: Stack,
  bands: Bands,
  weeks: Weeks,
  timeline: Timeline,
  mileage: Mileage,
  standing: Standing,
};

/** A measure's picture under "What changes", or nothing where it has none. */
export default function UnmodelledVisual({ measure, visuals = UNMODELLED_VISUALS }) {
  const spec = visuals[measure.id];
  const Drawing = spec && KINDS[spec.kind];
  if (!Drawing) return null;
  return (
    <section className="pchg umv-section" aria-label={`What changes: ${measure.name}`}>
      <div className="pchg-head">
        <p className="pchg-title">
          <ArrowRightLeft size={14} aria-hidden="true" />
          What changes
        </p>
      </div>
      <figure className={`umv is-kind-${spec.kind}`} role="img" aria-label={spec.alt} data-kind={spec.kind}>
        <figcaption className="umv-caption">{spec.caption}</figcaption>
        <Drawing spec={spec} />
      </figure>
    </section>
  );
}

export { KINDS as UNMODELLED_VISUAL_KINDS };

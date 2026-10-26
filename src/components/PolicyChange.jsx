import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  FIRST_YEAR,
  MONTHS,
  describeSegment,
  differs,
  formatChange,
  formatValue,
  loadPolicyParameters,
  summaryFor,
  visualFor,
} from "../utils/policyParameters";

/**
 * The model's "What changes" data (public/data/policy_parameters.json),
 * loaded once for every card. `override` (tests) skips the request.
 */
export function usePolicyParameters(override) {
  const [loaded, setLoaded] = useState(null);
  const given = override !== undefined;
  useEffect(() => {
    if (given) return undefined;
    let live = true;
    loadPolicyParameters().then((document) => {
      if (live) setLoaded(document);
    });
    return () => {
      live = false;
    };
  }, [given]);
  return given ? override : loaded;
}

// A change's tone, by the catalogue's direction for the measure: a measure
// that costs revenue leaves households better off, one that raises it
// worse off
const TONES = { cost: "gain", revenue: "loss" };

const HEIGHT = 160;
const MARGIN = { top: 22, right: 10, bottom: 24, left: 58 };
const DEFAULT_WIDTH = 520;

/** The width of an element, followed as it changes. */
function useWidth(ref) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
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

const YEAR_LABELS = Array.from({ length: MONTHS / 12 }, (_, i) => {
  const year = FIRST_YEAR + i;
  return { year, full: `${year}-${String((year + 1) % 100).padStart(2, "0")}`, short: `${String(year % 100)}-${String((year + 1) % 100).padStart(2, "0")}` };
});

/**
 * Current law (grey, dashed) and the measure (its colour) as steps across
 * April 2026 to March 2032, on a true time axis, with the gap between them
 * shaded in the gain or loss colour and labelled where it is largest and
 * where it ends. Hover, or the arrow keys, pick a step: a guide, a line in
 * words, and its years marked on the card's timeline.
 */
function StepPlot({ row, segments, tone, onHighlight, label }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  // The picked step, by index: the segments are rebuilt each render
  const [picked, setPicked] = useState(null);
  const active = picked === null ? null : segments[picked] ?? null;
  const { unit } = row;
  const values = segments.flatMap((s) => [s.before, s.after]).filter((v) => v !== null && v !== undefined);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || Math.abs(high) || 1) * 0.18;
  const lo = low >= 0 ? Math.max(low - pad, 0) : low - pad;
  const hi = high + pad;
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 60);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (month) => MARGIN.left + (month / MONTHS) * plotW;
  const y = (value) => MARGIN.top + (1 - (value - lo) / (hi - lo)) * plotH;
  const path = (key) =>
    segments
      .map((s, i) => `${i ? "L" : "M"}${x(s.start).toFixed(1)},${y(s[key]).toFixed(1)}H${x(s.end).toFixed(1)}`)
      .join("");
  const gaps = segments.filter(differs);
  const area = gaps
    .map((s) => `M${x(s.start).toFixed(1)},${y(s.before).toFixed(1)}H${x(s.end).toFixed(1)}V${y(s.after).toFixed(1)}H${x(s.start).toFixed(1)}Z`)
    .join("");
  // The gap's labels: its largest and its latest, once each
  const size = (s) => Math.abs(s.after - s.before);
  const largest = gaps.reduce((big, s) => (size(s) > size(big) + 1e-9 ? s : big), gaps[0]);
  const latest = gaps[gaps.length - 1];
  const labelled = [...new Set([largest, latest])].filter(Boolean);
  const ticks = [...new Set([low, high].map((v) => Math.round(v * 1e6) / 1e6))];
  const set = (index) => {
    const segment = index === null || index < 0 ? null : segments[index];
    setPicked(segment ? index : null);
    onHighlight?.(segment ? { from: segment.from, to: segment.to } : null);
  };
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const month = ((event.clientX - box.left) * (width / box.width) - MARGIN.left) / plotW * MONTHS;
    set(segments.findIndex((s) => month >= s.start && month < s.end));
  };
  const step = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return set(null);
    const index = picked ?? -1;
    set(event.key === "ArrowRight" ? Math.min(index + 1, segments.length - 1) : Math.max(index - 1, 0));
  };
  const tipLeft = active ? Math.min(Math.max(x((active.start + active.end) / 2), 135), width - 135) : 0;
  return (
    <div className="pchg-plot" ref={wrap}>
      <svg
        className={`pchg-svg is-${tone}`}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => set(null)}
        onKeyDown={step}
        onBlur={() => set(null)}
      >
        {YEAR_LABELS.map(({ year }) => (
          <line key={year} className="pchg-grid" x1={x((year - FIRST_YEAR) * 12)} x2={x((year - FIRST_YEAR) * 12)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
        ))}
        <line className="pchg-axis" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} />
        {ticks.map((value) => (
          <text key={value} className="pchg-tick" x={MARGIN.left - 6} y={y(value)} dy="0.32em" textAnchor="end">
            {formatValue(value, unit)}
          </text>
        ))}
        {YEAR_LABELS.map(({ year, full, short }) => (
          <text key={year} className="pchg-year" x={x((year - FIRST_YEAR) * 12 + 6)} y={HEIGHT - 6} textAnchor="middle">
            {plotW < 330 ? short : full}
          </text>
        ))}
        {active && (
          <rect className="pchg-guide" x={x(active.start)} width={Math.max(x(active.end) - x(active.start), 2)} y={MARGIN.top} height={plotH} />
        )}
        <path className="pchg-gap" d={area} />
        <path className="pchg-before" d={path("before")} />
        {/* A darker casing under the measure's colour, so a light one shows */}
        <path className="pchg-after-casing" d={path("after")} />
        <path className="pchg-after" d={path("after")} />
        {labelled.map((s) => {
          const cx = Math.min(Math.max(x((s.start + s.end) / 2), MARGIN.left + 28), MARGIN.left + plotW - 28);
          // Inside the gap when it is tall enough, else just above it
          const top = Math.min(y(s.before), y(s.after));
          const bottom = Math.max(y(s.before), y(s.after));
          const cy = bottom - top > 22 ? (top + bottom) / 2 + 4 : top - 7;
          return (
            <text key={s.label} className="pchg-gap-label" x={cx} y={cy} textAnchor="middle">
              {formatChange(s.before, s.after, unit)}
            </text>
          );
        })}
      </svg>
      {active && (
        <p className="pchg-tip" style={{ left: tipLeft }} aria-hidden="true">
          {describeSegment(active, unit)}
        </p>
      )}
    </div>
  );
}

/** One change that holds: before and after as two bars to scale. */
function Pair({ row, visual, tone }) {
  const { unit } = row;
  const top = Math.max(Math.abs(visual.before ?? 0), Math.abs(visual.after ?? 0)) || 1;
  const share = (value) => `${(Math.abs(value ?? 0) / top) * 100}%`;
  const rate = unit === "percent";
  return (
    <div className="pchg-pair">
      <div className="pchg-pair-row is-before">
        <span className="pchg-pair-name">Current law</span>
        <span className="pchg-bar-track"><span className="pchg-bar" style={{ width: share(visual.before) }} /></span>
        <span className="pchg-pair-value">{formatValue(visual.before, unit)}</span>
      </div>
      <div className="pchg-pair-row is-after">
        <span className="pchg-pair-name">With the measure</span>
        <span className="pchg-bar-track"><span className="pchg-bar" style={{ width: share(visual.after) }} /></span>
        <span className="pchg-pair-value">
          {formatValue(visual.after, unit)}
          {!rate && <span className={`pchg-chip is-${tone}`}>{formatChange(visual.before, visual.after, unit)}</span>}
        </span>
      </div>
    </div>
  );
}

/** Every row and value as a table, for screen readers. */
function HiddenTable({ rows }) {
  return (
    <table className="policy-sr-only">
      <caption>What changes, current law beside the measure</caption>
      <thead>
        <tr>
          <th scope="col">Parameter and when</th>
          <th scope="col">Current law</th>
          <th scope="col">With the measure</th>
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((row) =>
          row.points.map((point) => (
            <tr key={`${row.label}|${point.key}`}>
              <th scope="row">{`${row.label}, ${point.label}`}</th>
              <td>{formatValue(point.before, row.unit)}</td>
              <td>{formatValue(point.after, row.unit)}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

/**
 * A card's "What changes": one line on the change, then its picture. A
 * change that moves over the years is a step plot of current law against
 * the measure; one that holds from when it starts is a before-and-after
 * pair to scale. The first primary row is drawn; the others are a line of
 * words each. Every value is also in a table for screen readers.
 */
export default function PolicyChange({ rows, direction, onHighlight }) {
  const id = useId();
  const tone = TONES[direction] ?? "neutral";
  const drawn = rows.filter((row) => row.primary && visualFor(row));
  if (!drawn.length) return null;
  const [main, ...others] = drawn;
  const visual = visualFor(main);
  const summary = summaryFor(main);
  const alternative = visual.kind === "plot"
    ? `${summary} ${visual.segments.map((s) => describeSegment(s, main.unit)).join("; ")}.`
    : summary;
  return (
    <section className="pchg" aria-labelledby={`${id}-title`}>
      <div className="pchg-head">
        <p className="pchg-title" id={`${id}-title`}>What changes</p>
        {visual.kind === "plot" && (
          <p className="pchg-key" aria-hidden="true">
            <span className="pchg-key-before">Current law</span>
            <span className="pchg-key-after">With the measure</span>
          </p>
        )}
      </div>
      <p className="pchg-summary">
        {summary}
        {main.unit_words && <span className="pchg-unit"> ({main.unit_words})</span>}
      </p>
      {visual.kind === "plot" ? (
        <StepPlot row={main} segments={visual.segments} tone={tone} onHighlight={onHighlight} label={alternative} />
      ) : (
        <Pair row={main} visual={visual} tone={tone} />
      )}
      {others.map((row) => (
        <p key={row.label} className="pchg-also">{summaryFor(row)}</p>
      ))}
      <HiddenTable rows={rows} />
    </section>
  );
}

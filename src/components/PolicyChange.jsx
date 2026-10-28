import { createElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import CountUpText from "./CountUpText";
import { ArrowRight, ArrowRightLeft, Coins, Flame, Fuel, Percent, Table, Zap } from "lucide-react";
import {
  FIRST_YEAR,
  MONTHS,
  describeSegment,
  differs,
  formatChange,
  formatValue,
  loadPolicyParameters,
  mainRow,
  segmentsFor,
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

const HEIGHT = 140;
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
  // Each change labelled once: a lasting step that holds the same gap to
  // the end is labelled where it starts only
  const sameGap = largest && latest && largest.before === latest.before && largest.after === latest.after;
  const labelled = [...new Set(sameGap ? [largest] : [largest, latest])].filter(Boolean);
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

// A before-and-after's icon, from what the parameter is: its unit, and
// words in its name (a kind of thing, never a measure's name)
const ICONS = [
  [/petrol|diesel|fuel/i, Fuel],
  [/electric/i, Zap],
  [/gas|heat|warm/i, Flame],
];
export function iconFor(row) {
  const match = ICONS.find(([words]) => words.test(row.label));
  if (match) return match[1];
  return row.unit === "percent" ? Percent : Coins;
}

/** A change in a rate's points, or in an amount: "−5 points", "+£100". */
export function tileChange(before, after, unit) {
  if (unit !== "percent") return formatChange(before, after, unit);
  const points = Math.round((after - before) * 10000) / 100;
  const size = Math.abs(points).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return `${points > 0 ? "+" : "\u2212"}${size} ${Math.abs(points) === 1 ? "point" : "points"}`;
}

/**
 * One change, before and after: a label row with the parameter's icon,
 * then a "Current law" tile (muted, struck through) and a "With the
 * measure" tile (the measure's colour, bold), an arrow between, and the
 * change under the second. When it applies is on the card's timeline; only
 * where the change varies over the years (`when`, the period of the first
 * value shown) does the label say which of them the tiles show.
 */
function BeforeAfter({ row, point, tone, when }) {
  const { unit } = row;
  return (
    <div className="pchg-ba">
      <p className="pchg-ba-label">
        {createElement(iconFor(row), { size: 16, "aria-hidden": "true" })}
        <span>
          {row.label}
          {when && <span className="pchg-ba-when">, {when}</span>}
        </span>
      </p>
      <div className="pchg-ba-tiles">
        <div className="pchg-tile is-before">
          <span className="pchg-tile-name">Current law</span>
          <span className="pchg-tile-value"><CountUpText text={formatValue(point.before, unit)} /></span>
        </div>
        <ArrowRight className="pchg-ba-arrow" size={20} aria-label="becomes" />
        <div className="pchg-tile is-after">
          <span className="pchg-tile-name">With the policy</span>
          {/* The change beside the value, so both tiles keep one height */}
          <span className="pchg-tile-row">
            <span className="pchg-tile-value"><CountUpText text={formatValue(point.after, unit)} /></span>
            <span className={`pchg-chip is-${tone}`}>{tileChange(point.before, point.after, unit)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Whether a row's change differs in size from one period to another. */
export function variesByPeriod(row) {
  const pairs = new Set(
    (row?.points ?? []).filter(differs).map((point) => `${point.before}|${point.after}`),
  );
  return pairs.size > 1;
}

/** Values side by side: only the lines where the measure differs. */
function ChangeTable({ lines, unit, tone, caption, first }) {
  return (
    <table className="pchg-table">
      {caption && <caption className="pchg-caption">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col">{first}</th>
          <th scope="col">Current law</th>
          <th scope="col">With the policy</th>
          <th scope="col"><span className="policy-sr-only">Change</span></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key}>
            <th scope="row">{line.label}</th>
            <td>{formatValue(line.before, line.unit ?? unit)}</td>
            <td className="pchg-table-after">{formatValue(line.after, line.unit ?? unit)}</td>
            <td>
              <span className={`pchg-chip is-${tone}`}>{formatChange(line.before, line.after, line.unit ?? unit)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const plotCaption = (row) => (row.unit_words ? `${row.label}, ${row.unit_words}` : row.label);

/** The plot's key: current law dashed grey, the measure in its colour. */
const Key = () => (
  <p className="pchg-key" aria-hidden="true">
    <span className="pchg-key-before">Current law</span>
    <span className="pchg-key-after">With the policy</span>
  </p>
);

/** A table behind a button, closed until asked for. */
function Reveal({ show, hide, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="pchg-more"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Table size={14} aria-hidden="true" />
        {open ? hide : show}
      </button>
      <div id={id} hidden={!open}>
        {open && children}
      </div>
    </>
  );
}

/**
 * A card's "What changes", in one form for every measure (#260): the main
 * parameter's current law and the policy as two tiles with the change,
 * then, where the change varies over the years or is a `switch` (a change
 * for a while only: a window, or one winter), the step plot of the two
 * over April 2026 to March 2032 (on dates the rates change, for a
 * `schedule`). Everything else sits behind a button: the years or dates as
 * a table, the yearly averages, or every parameter that changes when there
 * are several. Each fact once: lines where the measure equals current law
 * are left out.
 */
export default function PolicyChange({ entry, direction, onHighlight, name, lead }) {
  const id = useId();
  const tone = TONES[direction] ?? "neutral";
  const main = mainRow(entry);
  const first = main?.points?.find(differs);
  if (!main || !first) return null;
  const schedule = entry.display === "schedule";
  const varies = variesByPeriod(main);
  // One visual per change: the tiles for a single change of value, and a
  // plot only where the value moves over the years (fuel duty's dates, the
  // Pension Tax Allowance's path)
  const plots = varies;
  const segments = plots ? segmentsFor(main) : [];
  const plotted = segments.some(differs);
  // A schedule's or a window's averages over each fiscal year, where the
  // main row is not already by year
  const byYear = main.points.every((point) => /^\d{4}-\d{2}$/.test(point.label));
  const yearly = byYear ? null : entry.rows.find((row) => !row.primary && row.unit === main.unit) ?? null;
  // Every changing line of every parameter, when the measure moves more than one
  const lines = entry.rows.filter((row) => row !== yearly).flatMap((row) =>
    row.points.filter(differs).map((point) => ({ ...point, key: `${row.label}|${point.key}`, label: row.label, unit: row.unit, period: point.label })),
  );
  const others = entry.rows.filter((row) => row !== main && row !== yearly && row.points.some(differs));
  const pairs = entry.display === "pairs";
  const periods = [...new Set(lines.map((line) => line.period))];
  return (
    // Named with its measure: each card's section says "What changes", and
    // regions on one page need different names (axe landmark-unique)
    <section className="pchg" aria-labelledby={name ? undefined : `${id}-title`} aria-label={name ? `What changes: ${name}` : undefined}>
      <div className="pchg-head">
        <p className="pchg-title" id={`${id}-title`}>
          <ArrowRightLeft size={14} aria-hidden="true" />
          What changes
        </p>
      </div>
      {/* A card's own words for the change, where it has them, before the values */}
      {lead && <p className="pchg-lead">{lead}</p>}
      <BeforeAfter row={main} point={first} tone={tone} when={varies ? (schedule ? `from ${first.label}` : first.label) : null} />
      {/* "pairs": every changing parameter as its own before and after */}
      {pairs && others.map((row) => <BeforeAfter key={row.label} row={row} point={row.points.find(differs)} tone={tone} when={null} />)}
      {/* The file's own line on the main row, where it has one */}
      {main.card_note && <p className="pchg-caption pchg-note">{main.card_note}</p>}
      {plotted && (
        <>
          <div className="pchg-head is-plot">
            <p className="pchg-caption">{plotCaption(main)}</p>
            <Key />
          </div>
          <StepPlot
            row={main}
            segments={segments}
            tone={tone}
            onHighlight={onHighlight}
            label={`${plotCaption(main)}. ${segments.map((s) => describeSegment(s, main.unit)).join("; ")}.`}
          />
        </>
      )}
      {(varies || yearly?.points.some(differs) || (others.length > 0 && !pairs)) && (
        <div className="pchg-reveals">
          {/* One changed period is the tiles already: no table of it */}
          {varies && (
            <Reveal show={schedule ? "Show the dates" : "Show the years"} hide={schedule ? "Hide the dates" : "Hide the years"}>
              <ChangeTable lines={main.points.filter(differs)} unit={main.unit} tone={tone} first={schedule ? "From" : "Year"} />
            </Reveal>
          )}
          {yearly && yearly.points.some(differs) && (
            <Reveal show="Show the yearly averages" hide="Hide the yearly averages">
              <ChangeTable lines={yearly.points.filter(differs)} unit={yearly.unit} tone={tone} first="Year" caption={yearly.note} />
            </Reveal>
          )}
          {others.length > 0 && !pairs && (
            <Reveal show="Show every change" hide="Hide every change">
              <ChangeTable
                lines={periods.length === 1 ? lines : lines.map((line) => ({ ...line, label: `${line.label}, ${line.period}` }))}
                unit={main.unit}
                tone={tone}
                first={periods.length === 1 ? periods[0] : "Parameter"}
              />
            </Reveal>
          )}
        </div>
      )}
    </section>
  );
}

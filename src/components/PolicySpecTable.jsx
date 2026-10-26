import { useEffect, useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  differs,
  formatChange,
  formatValue,
  loadPolicyParameters,
  sparkline,
  unitName,
  visibleRows,
} from "../utils/policyParameters";

/**
 * The model's "What changes" tables (public/data/policy_parameters.json),
 * loaded once for every card. `override` (tests) skips the request.
 */
export function usePolicyParameters(override) {
  const [tables, setTables] = useState(override ?? null);
  useEffect(() => {
    if (override !== undefined) {
      setTables(override);
      return undefined;
    }
    let live = true;
    loadPolicyParameters().then((document) => {
      if (live) setTables(document);
    });
    return () => {
      live = false;
    };
  }, [override]);
  return tables;
}

// A change's tone, by the catalogue's direction for the measure: a measure
// that costs revenue leaves households better off, one that raises it
// worse off
const TONES = { cost: "gain", revenue: "loss" };

/** Current law (grey, dashed) and the measure (teal) across the years. */
function Sparkline({ points, highlight }) {
  const spark = sparkline(points);
  if (!spark) return null;
  const marked = highlight ? spark.xs.filter((p) => p.year >= highlight.from && p.year <= highlight.to) : [];
  return (
    <svg
      className="pspec-spark"
      viewBox={`0 0 ${spark.width} ${spark.height}`}
      width={spark.width}
      height={spark.height}
      aria-hidden="true"
      focusable="false"
    >
      {marked.map((p) => (
        <line key={p.x} className="pspec-spark-mark" x1={p.x} x2={p.x} y1="0" y2={spark.height} />
      ))}
      <polyline className="pspec-spark-before" points={spark.before} />
      <polyline className="pspec-spark-after" points={spark.after} />
    </svg>
  );
}

/**
 * A card's "What changes": a compact table of the policy parameters the
 * measure changes, current law beside the measure, with each change as a
 * chip in the gain or loss colour. Collapsed to the years that differ (at
 * most three lines); "Show all years" opens every year and the rows behind
 * them. Hovering or focusing a line marks its years on the card's timeline
 * (`onHighlight`) and on the row's sparkline.
 */
export default function PolicySpecTable({ rows, direction, highlight, onHighlight }) {
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const { rows: shown, more } = visibleRows(rows, { expanded });
  const tone = TONES[direction] ?? "neutral";
  const mark = (line) => () => onHighlight?.({ from: line.from, to: line.to });
  const clear = () => onHighlight?.(null);
  return (
    <section className="pspec" aria-label="What changes">
      <div className="pspec-head">
        <p className="pspec-title">What changes</p>
        <p className="pspec-key" aria-hidden="true">
          <span className="pspec-key-before">Current law</span>
          <ArrowRight size={12} />
          <span className="pspec-key-after">With the measure</span>
        </p>
      </div>
      <div className="pspec-scroll">
        <table className="pspec-table" id={tableId}>
          <thead className="policy-sr-only">
            <tr>
              <th scope="col">When</th>
              <th scope="col">Current law</th>
              <th scope="col">With the measure</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          {shown.map((row) => (
            <tbody key={row.label} className="pspec-group">
              <tr className="pspec-row-head">
                <th scope="colgroup" colSpan={4}>
                  <span className="pspec-label">{row.label}</span>
                  {unitName(row.unit) && <span className="pspec-unit">{unitName(row.unit)}</span>}
                  <Sparkline points={row.points} highlight={highlight} />
                  {expanded && row.note && <span className="pspec-note">{row.note}</span>}
                </th>
              </tr>
              {row.lines.map((line) => {
                const changed = differs(line);
                const lit = highlight && line.from <= highlight.to && line.to >= highlight.from;
                return (
                  <tr
                    key={line.key}
                    className={`pspec-line${changed ? "" : " is-same"}${lit ? " is-lit" : ""}`}
                    onMouseEnter={mark(line)}
                    onMouseLeave={clear}
                    onFocus={mark(line)}
                    onBlur={clear}
                    tabIndex={0}
                  >
                    <th scope="row" className="pspec-when">
                      {/* Wraps between words only, never inside "2026-27" */}
                      {line.label.split(" ").map((word, i) => (
                        <span key={i} className="pspec-word">{i ? ` ${word}` : word}</span>
                      ))}
                    </th>
                    <td className="pspec-before">{formatValue(line.before, row.unit)}</td>
                    <td className="pspec-after">
                      <ArrowRight className="pspec-arrow" size={12} aria-hidden="true" />
                      {formatValue(line.after, row.unit)}
                    </td>
                    <td className="pspec-change">
                      <span className={`pspec-chip is-${changed ? tone : "same"}`}>
                        {formatChange(line.before, line.after, row.unit)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {more && (
        <button
          type="button"
          className="pspec-more"
          aria-expanded={expanded}
          aria-controls={tableId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show fewer" : "Show all years"}
        </button>
      )}
    </section>
  );
}

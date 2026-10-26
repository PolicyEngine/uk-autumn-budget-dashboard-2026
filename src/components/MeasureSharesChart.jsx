// Better and worse off, one row per measure (each measure's own published
// shares; never added up): the measure's name, wrapped to two lines and
// never clipped, a 100% bar (better off, unchanged, worse off) and the
// ▲ better off and ▼ worse off shares in two fixed right-aligned columns.
// The one chart for this view on every card (Young people, Pensioners).

import { useRef } from "react";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import { CHART_COLOURS } from "../utils/chartTheme";
import { formatShare, visibleSegments } from "../utils/shareFormat";
import "./MeasureSharesChart.css";

const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: CHART_COLOURS.gain },
  { key: "pct_unchanged", label: "Unchanged", color: CHART_COLOURS.noChange },
  { key: "pct_worse_off", label: "Worse off", color: CHART_COLOURS.loss },
];
const KEYS = OUTCOMES.map((outcome) => outcome.key);

/**
 * @param {{rows: Array<{id: string, name: string, fullName?: string, row: Object}>,
 *   groupLabel: string, yearLabel: string}} props - rows as drawn, in order
 */
export default function MeasureSharesChart({ rows, groupLabel, yearLabel }) {
  const ref = useRef(null);
  const { tip, handlers } = useFloatingTooltip(ref, `${groupLabel}-${yearLabel}-${rows.length}`);
  return (
    <div className="msc-wrap">
    <div ref={ref} className="msc" role="table" aria-label={`Better and worse off, ${groupLabel}, each measure on its own, ${yearLabel}`}>
      <div className="msc-row msc-head" role="row">
        <span className="msc-label" />
        <span className="msc-bar-cell" />
        <span className="msc-num" role="columnheader">
          <span className="msc-up">▲</span> Better
        </span>
        <span className="msc-num" role="columnheader">
          <span className="msc-down">▼</span> Worse
        </span>
      </div>
      {rows.map(({ id, name, fullName, row }) => {
        const drawn = visibleSegments(Object.fromEntries(KEYS.map((key) => [key, row[key] ?? 0])), KEYS);
        return (
          <div className="msc-row" role="row" key={id}>
            <span className="msc-label" role="rowheader" title={fullName ?? name}>
              {name}
            </span>
            <span
              className="msc-bar-cell has-tooltip"
              role="cell"
              tabIndex={0}
              aria-label={OUTCOMES.map((o) => `${o.label} ${formatShare(drawn.real[o.key])}`).join(", ")}
              {...handlers(
                id,
                <TooltipRows
                  label={`${fullName ?? name}: ${groupLabel.toLowerCase()}, ${yearLabel}`}
                  rows={OUTCOMES.map((o) => ({ key: o.key, name: o.label, text: formatShare(drawn.real[o.key]), color: o.color }))}
                />,
              )}
            >
              <span className="msc-bar">
                {OUTCOMES.map((o) =>
                  drawn[o.key] > 0 ? (
                    <span key={o.key} className="msc-seg" style={{ width: `${drawn[o.key]}%`, background: o.color }} />
                  ) : null,
                )}
              </span>
            </span>
            <span className="msc-num" role="cell">
              {formatShare(drawn.real.pct_better_off)}
            </span>
            <span className="msc-num" role="cell">
              {formatShare(drawn.real.pct_worse_off)}
            </span>
          </div>
        );
      })}
      <FloatingTooltip tip={tip} />
    </div>
    </div>
  );
}

import useElementWidth from "../../hooks/useElementWidth";
import { CHART_COLOURS } from "../../utils/chartTheme";
import { money, signedMoney } from "../../utils/singleYear";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../FloatingTooltip";

const TEXT = CHART_COLOURS.text;
const BEFORE_COLOUR = "#9CA3AF";
const AFTER_COLOUR = "#319795";

/**
 * Net income from before to after: the starting net income, each policy's
 * change stepping from where the last one ended, then the final net
 * income. Steps are tens of pounds on incomes of thousands, so the scale
 * starts just below the lowest point: the before and after bars are cut
 * short (the break marks at their left say so) and each step shows at a
 * readable width.
 *
 * @param {Object} props
 * @param {{before: number, after: number, change: number}} props.totals - headlineTotals
 * @param {Array<{id, name, color, rounded}>|null} props.steps - policyRows(...).rows,
 *   or null while the split by policy is calculated (one step for all of them)
 * @param {string} props.yearLabel - "2029-30"
 */
export default function NetIncomeWaterfall({ totals, steps, yearLabel }) {
  const [wrapperRef, measured] = useElementWidth();
  const width = measured > 0 ? measured : 520;
  const pending = steps === null;
  const shownSteps = pending
    ? [{ id: "all", name: "Selected policies", color: CHART_COLOURS.noChange, rounded: totals.change }]
    : steps;
  // Each row: where its bar starts and ends
  const stepRows = shownSteps.reduce((done, step) => {
    const from = done.length ? done[done.length - 1].to : totals.before;
    return [...done, { ...step, from, to: from + step.rounded }];
  }, []);
  const rows = [
    { id: "before", name: "Net income before", color: BEFORE_COLOUR, from: null, to: totals.before, total: true },
    ...stepRows,
    { id: "after", name: "Net income after", color: AFTER_COLOUR, from: null, to: totals.after, total: true },
  ];
  const { tip, handlers } = useFloatingTooltip(
    wrapperRef,
    `${yearLabel}:${rows.map((row) => `${row.id}=${row.to}`).join(",")}`,
  );

  const levels = rows.map((row) => row.to);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = Math.max(hi - lo, 1);
  // The scale's left edge: below the lowest point by more than the steps
  // span, so the totals' bars stay long and the steps readable
  const start = lo - span * 1.5;
  const fontSize = 13;
  const valueRoom = 78;
  const plotLeft = 10;
  const plotRight = Math.max(width - valueRoom, plotLeft + 80);
  const x = (value) => plotLeft + ((value - start) / (hi - start)) * (plotRight - plotLeft);
  const rowHeight = 40;
  const barHeight = 12;
  const top = 2;
  const height = top + rows.length * rowHeight;
  const barY = (index) => top + index * rowHeight + 20;

  return (
    <div className="net-income-waterfall" id="change-by-policy" data-split={pending ? "pending" : "ready"} data-year={yearLabel}>
      <div ref={wrapperRef} style={{ position: "relative" }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Net income from before to after the selected policies, ${yearLabel}: ${rows
            .map((row) => `${row.name} ${row.total ? money(row.to) : signedMoney(row.rounded)}`)
            .join("; ")}`}
        >
          {rows.map((row, index) => {
            const y = barY(index);
            const x0 = row.total ? plotLeft : Math.min(x(row.from), x(row.to));
            const x1 = row.total ? x(row.to) : Math.max(x(row.from), x(row.to));
            const value = row.total ? money(row.to) : signedMoney(row.rounded);
            return (
              <g
                key={row.id}
                className={`waterfall-row ${row.total ? "is-total" : "is-step"}`}
                data-row={row.id}
                tabIndex={0}
                aria-label={`${row.name}: ${value}`}
                {...handlers(
                  row.id,
                  <TooltipRows
                    label={`${row.name}, ${yearLabel}`}
                    rows={[
                      {
                        key: row.id,
                        name: row.total ? "Net income" : "Change in net income",
                        text: `${value} a year`,
                        color: row.color,
                      },
                    ]}
                  />,
                )}
              >
                <rect x={0} y={y - 20} width={width} height={rowHeight} fill="transparent" />
                <text x={plotLeft} y={y - 6} fontSize={fontSize} fontWeight={row.total ? 600 : 400} fill={TEXT}>
                  {row.name}
                </text>
                <rect x={x0} y={y} width={Math.max(x1 - x0, 2)} height={barHeight} rx={2} fill={row.color} />
                {row.total && (
                  // The scale does not start at zero: a break at the bar's left
                  <path
                    d={`M${plotLeft - 5} ${y + barHeight + 2} l4 -${barHeight + 4} M${plotLeft - 1} ${y + barHeight + 2} l4 -${barHeight + 4}`}
                    stroke="var(--pe-surface, #fff)"
                    strokeWidth={2}
                    transform={`translate(${12} 0)`}
                  />
                )}
                <text
                  x={width}
                  y={y + barHeight / 2}
                  dy="0.35em"
                  textAnchor="end"
                  fontSize={fontSize}
                  fontWeight={600}
                  fill={TEXT}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {value}
                </text>
                {/* The connector to the next row's start */}
                {index < rows.length - 1 && (
                  <line
                    x1={x(row.to)}
                    x2={x(row.to)}
                    y1={y + barHeight}
                    y2={barY(index + 1)}
                    stroke={TEXT}
                    strokeOpacity={0.35}
                    strokeDasharray="2 2"
                  />
                )}
              </g>
            );
          })}
        </svg>
        <FloatingTooltip tip={tip} />
      </div>
      {pending && (
        <p className="single-year-quiet waterfall-pending" role="status">
          Splitting the change by policy…
        </p>
      )}
    </div>
  );
}

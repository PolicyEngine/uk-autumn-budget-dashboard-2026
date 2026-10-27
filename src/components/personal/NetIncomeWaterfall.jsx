import useElementWidth from "../../hooks/useElementWidth";
import { BAR_RADIUS, CHART_COLOURS } from "../../utils/chartTheme";
import { money, signedMoney } from "../../utils/singleYear";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../FloatingTooltip";
import TitleIcon from "../TitleIcon";

const TEXT = CHART_COLOURS.text;
const BEFORE_COLOUR = CHART_COLOURS.before;
const AFTER_COLOUR = CHART_COLOURS.after;

// A name mid-sentence: lower case first, unless it starts with an acronym
const midSentence = (name) => (/^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));

/**
 * The card's one line, from the figures: where net income goes, then the
 * policy that adds (or takes) the most; with gains and losses both, the
 * largest of each. "Your net income rises from £70,050 to £70,159 in
 * 2027-28; zero VAT on electricity adds the most (+£56)."
 *
 * @param {{before: number, after: number}} totals
 * @param {Array<{name: string, label?: string, rounded: number}>|null} steps - null while split
 * @param {string} yearLabel
 */
export function waterfallSentence(totals, steps, yearLabel) {
  const change = Math.round(totals.after - totals.before);
  const lead =
    change === 0
      ? `Your net income stays at ${money(totals.before)} in ${yearLabel}`
      : `Your net income ${change > 0 ? "rises" : "falls"} from ${money(totals.before)} to ${money(totals.after)} in ${yearLabel}`;
  const moving = (steps ?? []).filter((step) => step.id !== "interaction" && Math.round(step.rounded) !== 0);
  if (!moving.length) return `${lead}.`;
  const nameOf = (step) => midSentence(step.label ?? step.name);
  if (moving.length === 1) {
    const [only] = moving;
    return `${lead}; ${nameOf(only)} ${only.rounded > 0 ? "adds" : "takes"} ${money(Math.abs(only.rounded))} a year.`;
  }
  const gains = moving.filter((step) => step.rounded > 0).sort((a, b) => b.rounded - a.rounded);
  const losses = moving.filter((step) => step.rounded < 0).sort((a, b) => a.rounded - b.rounded);
  if (gains.length && losses.length) {
    return `${lead}; ${nameOf(gains[0])} adds the most (${signedMoney(gains[0].rounded)}) and ${nameOf(losses[0])} takes the most (${signedMoney(losses[0].rounded)}).`;
  }
  const top = gains[0] ?? losses[0];
  return `${lead}; ${nameOf(top)} ${top.rounded > 0 ? "adds" : "takes"} the most (${signedMoney(top.rounded)}).`;
}

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
 * @param {boolean} [props.splitFailed] - The split by policy failed: one step
 *   for all of them, with no "Splitting…" line (the error is shown below)
 * @param {Array<{id, name, label}>} [props.noEffect] - The measures that
 *   leave the household's net income where it was (policyRows(...).noEffectItems):
 *   one muted line under the steps, by short name, not a row each
 */
export default function NetIncomeWaterfall({ totals, steps, yearLabel, splitFailed = false, noEffect = [] }) {
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
    <div className="net-income-waterfall" id="change-by-policy" data-split={pending ? (splitFailed ? "unavailable" : "pending") : "ready"} data-year={yearLabel}>
      {/* A title and one line, as every card has */}
      <div className="chart-header waterfall-header">
        <div>
          <h3>
            <TitleIcon name="bars" />
            <span className="title-text">How each policy changes your income</span>
          </h3>
          <p className="chart-description">{waterfallSentence(totals, pending ? null : shownSteps, yearLabel)}</p>
        </div>
      </div>
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
                  {/* The short name on the bar; the full one in the tooltip */}
                  {row.label ?? row.name}
                </text>
                <rect x={x0} y={y} width={Math.max(x1 - x0, 2)} height={barHeight} rx={Math.min(BAR_RADIUS, barHeight / 2)} fill={row.color} />
                {row.total && (
                  // The scale does not start at zero: a break at the bar's left
                  <path
                    d={`M${plotLeft - 5} ${y + barHeight + 2} l4 -${barHeight + 4} M${plotLeft - 1} ${y + barHeight + 2} l4 -${barHeight + 4}`}
                    stroke={CHART_COLOURS.surface}
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
      {/* Why the totals' bars are cut short at their left */}
      <p className="single-year-quiet waterfall-scale-note">
        {`Bars start at ${money(Math.max(0, Math.floor(start / 100) * 100))}, not £0, so the changes are visible.`}
      </p>
      {!pending && noEffect.length > 0 && (
        <p className="single-year-quiet waterfall-no-effect">
          No effect on you:{" "}
          {noEffect.map((item, index) => (
            <span key={item.id} title={item.name}>
              {index > 0 && ", "}
              {item.label ?? item.name}
            </span>
          ))}
        </p>
      )}
      {pending && !splitFailed && (
        <p className="single-year-quiet waterfall-pending" role="status">
          Splitting the change by policy…
        </p>
      )}
    </div>
  );
}

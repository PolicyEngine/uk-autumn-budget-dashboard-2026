import { money, signedMoney } from "../../utils/singleYear";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../FloatingTooltip";
import TitleIcon from "../TitleIcon";
import { magnitudeColours } from "../../utils/chartTheme";
import { useId, useRef } from "react";

/**
 * The chart's text alternative (read out, not shown: the tiles above say
 * the change, the chart's chips the largest policy), leading with which
 * way net income moves, then the policy that moves it most. Each measure
 * by its own short name, never lower-cased: "State Pension protection".
 * "Your net income rises in 2027-28, mostly from Zero VAT on electricity (+£43)."
 *
 * @param {{before: number, after: number}} totals
 * @param {Array<{name: string, label?: string, rounded: number}>|null} steps - null while split
 * @param {string} yearLabel
 */
export function waterfallSentence(totals, steps, yearLabel) {
  const change = Math.round(totals.after - totals.before);
  const moving = (steps ?? []).filter((step) => step.id !== "interaction" && Math.round(step.rounded) !== 0);
  const nameOf = (step) => step.label ?? step.name;
  const gains = moving.filter((step) => step.rounded > 0).sort((a, b) => b.rounded - a.rounded);
  const losses = moving.filter((step) => step.rounded < 0).sort((a, b) => a.rounded - b.rounded);
  const lead =
    change === 0
      ? `${moving.length ? "No net change" : "No change"} to your net income in ${yearLabel}`
      : `Your net income ${change > 0 ? "rises" : "falls"} in ${yearLabel}`;
  if (!moving.length) return `${lead}.`;
  if (gains.length && losses.length) {
    const [first, second] = change < 0 ? [losses[0], gains[0]] : [gains[0], losses[0]];
    const verb = (step) => (step.rounded > 0 ? "adds" : "takes");
    return `${lead}: ${nameOf(first)} ${verb(first)} the most (${signedMoney(first.rounded)}) and ${nameOf(second)} ${verb(second)} the most (${signedMoney(second.rounded)}).`;
  }
  if (moving.length === 1) return `${lead}, all from ${nameOf(moving[0])}.`;
  const top = gains[0] ?? losses[0];
  // "Mostly" only when it is at least half the change
  return Math.abs(top.rounded) * 2 >= Math.abs(change)
    ? `${lead}, mostly from ${nameOf(top)} (${signedMoney(top.rounded)}).`
    : `${lead}; ${nameOf(top)} ${top.rounded > 0 ? "adds" : "takes"} the most (${signedMoney(top.rounded)}).`;
}

/**
 * The chips on the chart: the largest gain and the largest loss when the
 * policies pull both ways, else the largest one; none for a single policy
 * (or the one step for all of them while the split is calculated).
 *
 * @param {Array<{id: string, rounded: number}>|null} steps
 * @returns {Object<string, string>} chip text by row id
 */
export function largestSteps(steps) {
  const moving = (steps ?? []).filter((step) => step.id !== "interaction" && Math.round(step.rounded) !== 0);
  if (moving.length < 2) return {};
  const gains = moving.filter((step) => step.rounded > 0).sort((a, b) => b.rounded - a.rounded);
  const losses = moving.filter((step) => step.rounded < 0).sort((a, b) => a.rounded - b.rounded);
  if (gains.length && losses.length) return { [gains[0].id]: "Largest gain", [losses[0].id]: "Largest loss" };
  return { [(gains[0] ?? losses[0]).id]: "Largest" };
}

/** Each row of the waterfall: where its bar starts and ends. */
function waterfallRows(totals, steps) {
  const shownSteps = steps ?? [{ id: "all", name: "Selected policies", rounded: totals.change ?? totals.after - totals.before }];
  const stepRows = shownSteps.reduce((done, step) => {
    const from = done.length ? done[done.length - 1].to : totals.before;
    return [...done, { ...step, from, to: from + step.rounded }];
  }, []);
  return [
    { id: "before", name: "Net income before", from: null, to: totals.before, total: true },
    ...stepRows,
    { id: "after", name: "Net income after", from: null, to: totals.after, total: true },
  ];
}

/**
 * Where the bars start: a round £100 below the lowest point by more than
 * the steps span, so the before and after bars stay long and each step
 * readable. Said under "About this result"; drawn as the axis's one tick.
 *
 * @param {{before: number, after: number}} totals
 * @param {Array<{rounded: number}>|null} steps
 */
export function waterfallScaleStart(totals, steps) {
  const levels = waterfallRows(totals, steps).map((row) => row.to);
  const lo = Math.min(...levels);
  const span = Math.max(Math.max(...levels) - lo, 1);
  return Math.max(0, Math.floor((lo - span * 1.5) / 100) * 100);
}

/**
 * Net income from before to after: the starting net income, each policy's
 * change stepping from where the last one ended, then the final net
 * income. One row each, at one pitch: the name, the bar, the amount in one
 * right-aligned column. Gains and losses in their colours; before neutral,
 * after teal. The scale starts at a round amount below the lowest point
 * (its tick under the bars, a break mark on the before and after bars).
 *
 * @param {Object} props
 * @param {{before: number, after: number, change: number}} props.totals - headlineTotals
 * @param {Array<{id, name, label, rounded}>|null} props.steps - policyRows(...).rows,
 *   or null while the split by policy is calculated (one step for all of them)
 * @param {string} props.yearLabel - "2029-30"
 * @param {boolean} [props.splitFailed] - The split by policy failed: one step
 *   for all of them, with no "Splitting…" line (the error is shown below)
 */
export default function NetIncomeWaterfall({ totals, steps, yearLabel, splitFailed = false }) {
  const wrapperRef = useRef(null);
  const sentenceId = useId();
  const pending = steps === null;
  const rows = waterfallRows(totals, steps);
  const { tip, handlers } = useFloatingTooltip(
    wrapperRef,
    `${yearLabel}:${rows.map((row) => `${row.id}=${row.to}`).join(",")}`,
  );
  const start = waterfallScaleStart(totals, steps);
  const hi = Math.max(...rows.map((row) => row.to));
  const pct = (value) => ((value - start) / Math.max(hi - start, 1)) * 100;
  const largest = largestSteps(steps);
  // Each policy's bar by direction and size, the largest darkest; the
  // interaction step keeps its plain direction colour
  const policySteps = rows.filter((row) => !row.total && row.id !== "interaction");
  const shades = new Map(
    magnitudeColours(policySteps.map((row) => row.rounded)).map((colour, k) => [policySteps[k].id, colour]),
  );
  const sentence = waterfallSentence(totals, steps, yearLabel);
  // No change at all: the sentence is the panel's one note, shown
  const noChange = !rows.some((row) => !row.total && Math.round(row.rounded) !== 0);

  return (
    <div className="net-income-waterfall" id="change-by-policy" data-split={pending ? (splitFailed ? "unavailable" : "pending") : "ready"} data-year={yearLabel}>
      {/* A panel like the tiles above: their title, then the chart. The
          tiles say the change; the chart marks its largest policy. The
          sentence is the chart's text alternative, shown only when
          nothing changes */}
      <div className="waterfall-header">
        <h3 className="forecast-tile-head waterfall-title">
          <TitleIcon name="bars" className="forecast-tile-icon" />
          <span className="forecast-tile-name">How each policy changes your income</span>
        </h3>
        {!noChange && (
          // Named against the table below: this is by policy, that by tax
          // and benefit; both add up to the same change (Pavel's review, HH5)
          <p className="waterfall-sub">
            By policy. The table by tax and benefit below adds up to the same change.
          </p>
        )}
        <p id={sentenceId} className={noChange ? "waterfall-no-change" : "visually-hidden"}>
          {sentence}
        </p>
      </div>
      <div ref={wrapperRef} className="waterfall-chart" style={{ position: "relative" }}>
        <ol
          className="waterfall-rows"
          aria-describedby={sentenceId}
          aria-label={`Net income from before to after the selected policies, ${yearLabel}: ${rows
            .map((row) => `${row.name} ${row.total ? money(row.to) : signedMoney(row.rounded)}`)
            .join("; ")}`}
        >
          {rows.map((row, index) => {
            const value = row.total ? money(row.to) : signedMoney(row.rounded);
            const shade = shades.get(row.id);
            const tone = row.total ? row.id : row.rounded < 0 ? "loss" : row.rounded > 0 ? "gain" : "none";
            const left = row.total ? 0 : pct(Math.min(row.from, row.to));
            const right = row.total ? pct(row.to) : pct(Math.max(row.from, row.to));
            const name = row.label ?? row.name;
            const chip = largest[row.id];
            return (
              <li
                key={row.id}
                className={`waterfall-row ${row.total ? "is-total" : "is-step"} is-${tone}${chip ? " is-largest" : ""}`}
                style={shade ? { "--bar": shade } : undefined}
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
                        color: shade ?? `var(--c-${tone === "none" ? "before" : tone})`,
                      },
                    ]}
                  />,
                )}
              >
                {/* The short name; the full one in the row's tooltip (its
                    only tip: no native title) */}
                <span className="waterfall-name">
                  {name}
                </span>
                <span className="waterfall-track" aria-hidden="true">
                  <span className="waterfall-bar" style={{ left: `${left}%`, width: `max(2px, ${right - left}%)` }} />
                  {/* The scale does not start at zero: a break near the bar's left */}
                  {row.total && <span className="waterfall-break" />}
                  {/* The largest policy's chip, in the empty run left of its bar */}
                  {chip && (
                    <span className="waterfall-chip" style={{ right: `calc(${100 - left}% + 6px)` }}>
                      {chip}
                    </span>
                  )}
                  {/* The connector down to the next row's start */}
                  {index < rows.length - 1 && <span className="waterfall-link" style={{ left: `${pct(row.to)}%` }} />}
                </span>
                <span className="waterfall-value">{value}</span>
              </li>
            );
          })}
        </ol>
        {/* The axis's one tick: where the bars start, on the axis line */}
        <div className="waterfall-axis" aria-hidden="true">
          <span className="waterfall-axis-line">
            <span className="waterfall-axis-tick">{money(start)}</span>
          </span>
        </div>
        <FloatingTooltip tip={tip} />
      </div>
      {pending && !splitFailed && (
        <p className="single-year-quiet waterfall-pending" role="status">
          Splitting the change by policy…
        </p>
      )}
    </div>
  );
}

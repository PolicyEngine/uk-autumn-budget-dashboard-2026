import { useMemo, useRef, useState } from "react";
import NoBreakYear from "../NoBreakYear";
import { Area, CartesianGrid, ComposedChart, Customized, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import {
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  GRID_PROPS,
  TICK_STYLE,
  axisWidth,
  useNarrowViewport,
  CHART_COLOURS,
  sweepAxis,
  BEFORE_DASH,
  REFERENCE_DASH,
} from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort } from "../../utils/exampleHouseholds";
import ChartMoreInfo from "../ChartMoreInfo";
import { METHOD_ANCHORS } from "../methodology/anchors";
import { keepClause, marginalRates, rateAt } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import SeriesToggle from "../SeriesToggle";
import { AFTER_COLOUR, BEFORE_COLOUR, LEGEND_ITEMS, earningsChartHeight } from "./EarningsChart";
import { breakdownRows, describeParts, drawnKey, partsInUse, rateAxis, stepAt } from "./marginalRateParts";
import { SWEEP_COMPONENTS, hiddenParts, sweepChips } from "./sweepComponents";
import TitleIcon from "../TitleIcon";
import ControlBar from "../ControlBar";
import { CHART_VIEWS } from "./chartViews";

const pct = (value) => `${Math.round(value * 100)}%`;
const clampTo = ([lo, hi]) => (value) => Math.min(hi, Math.max(lo, value));
// The plot's right margin (the chart's margin.right)
const RIGHT_MARGIN = 20;
// Over the stacked parts the totals are drawn in ink, the before total dashed
const TOTAL_COLOUR = CHART_COLOURS.ink;
const CHANGE_COLOUR = CHART_COLOURS.ink;
// The dashboard's own terms (Pavel's review, HH6): "Total rate with the policies"
const SIDE_NAME = { before: "under current law", after: "with the policies" };
const points = (value) => {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}pp`;
};

/**
 * Symmetric ticks for a change in rate: ±4, 10, 20, 50 or 100 points
 * (whole-point halves), with 10% headroom past the largest change so it is
 * never drawn on the plot's edge.
 */
export function changeRateTicks(maxAbs) {
  const reach = maxAbs * 1.1;
  const top = [0.04, 0.1, 0.2, 0.5, 1].find((m) => m >= reach) ?? Math.ceil(reach);
  return [-top, -top / 2, 0, top / 2, top];
}

/** A dot only where the rate is off the axis: ▲ above, ▼ below. */
function EdgeMarker({ cx, cy, payload, dataKey, stroke, bounds = [0, 1] }) {
  const raw = payload?.[`${dataKey}Raw`];
  if (raw === undefined || (raw >= bounds[0] && raw <= bounds[1]) || cx === undefined) return null;
  const up = raw > bounds[1];
  const d = up
    ? `M${cx - 4},${cy + 5}L${cx + 4},${cy + 5}L${cx},${cy - 2}Z`
    : `M${cx - 4},${cy - 5}L${cx + 4},${cy - 5}L${cx},${cy + 2}Z`;
  return <path d={d} fill={stroke} />;
}

/**
 * The tooltip, for the view drawn only: in Before or After, that side's
 * parts in use and its total (the true rate, not the clipped one); in
 * Change, the change in the total rate.
 */
export function RateTooltip({ yearLabel, parts, view, focusPart = null, ...props }) {
  const point = props.payload?.[0]?.payload;
  if (!props.active || !point) return null;
  // The year never breaks across lines ("2027-" / "28")
  const labelFormat = (value) => <NoBreakYear text={`Employment income ${formatPounds(value)}, ${yearLabel}`} />;
  // On one part: that part alone ("At £40k: Income tax 20%")
  const one = view !== "change" && focusPart ? (parts ?? []).find((part) => part.name === focusPart) : null;
  if (one) {
    return (
      <ChartTooltip
        active
        label={point.income}
        grouped={false}
        showZero
        format={(value) => `${Math.round(value * 100)}%`}
        labelFormat={(value) => `At ${formatPoundsShort(value)}`}
        payload={[{ dataKey: one.name, name: one.label, value: point[one.name] ?? 0, color: one.color }]}
      />
    );
  }
  if (view === "change") {
    return (
      <ChartTooltip
        active
        label={point.income}
        grouped={false}
        showZero
        format={points}
        labelFormat={labelFormat}
        payload={[{ dataKey: "change", name: "Change in marginal rate", value: point.change, color: CHANGE_COLOUR }]}
      />
    );
  }
  const partRows = (parts ?? [])
    .filter((part) => Math.abs(point[part.name] ?? 0) >= 0.0005)
    .map((part) => ({ dataKey: part.name, name: part.label, value: point[part.name], color: part.color }));
  return (
    <ChartTooltip
      active
      label={point.income}
      grouped={false}
      showZero
      format={(value) => `${Math.round(value * 100)}%`}
      labelFormat={labelFormat}
      payload={[
        ...partRows,
        {
          dataKey: view,
          name: `Total rate ${SIDE_NAME[view]}`,
          value: point[`${view}Raw`],
          color: parts ? TOTAL_COLOUR : view === "before" ? BEFORE_COLOUR : AFTER_COLOUR,
        },
      ]}
    />
  );
}

/**
 * Marginal tax rate across earnings: of each extra pound of salary, the
 * share lost to taxes and withdrawn benefits, from the same sweep as the
 * net income chart (1 − Δnet / Δsalary). When the API sends the rate's
 * parts, they are stacked as steps after the policies (income tax, Child
 * Benefit clawback, personal allowance taper, National Insurance, student
 * loan, Universal Credit taper and the rest), with the total after solid
 * and before dashed; else the two totals alone. The axis is clipped to
 * 0–100%; a total past either end is marked at the edge, and the tooltip
 * gives it in full.
 */
export default function MarginalRateChart({ sweep, salary, yearLabel, sync = null }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  // The view and the components switched off are shared with the net
  // income card beside it (`sync`), else this card's own
  const [ownView, setOwnView] = useState("after");
  const view = sync?.view ?? ownView;
  const setView = sync?.setView ?? setOwnView;
  const [ownHidden, setOwnHidden] = useState([]);
  const hiddenKeys = sync?.hidden ?? ownHidden;
  const setHiddenKeys = sync?.setHidden ?? setOwnHidden;
  const hidden = useMemo(
    () => [...hiddenParts("rate", hiddenKeys), ...(hiddenKeys.includes("total") ? ["total"] : [])],
    [hiddenKeys],
  );
  // The component a chip or the pointer is on (its parts come forward)
  const [ownFocusKey, setOwnFocusKey] = useState(null);
  // Shared with the net income card when the pair has one Show control
  const focusKey = sync?.setFocus ? sync.focus : ownFocusKey;
  const setFocusKey = sync?.setFocus ?? setOwnFocusKey;
  const focusParts = focusKey ? (SWEEP_COMPONENTS.find((component) => component.key === focusKey)?.rate ?? [focusKey]) : null;
  const focus = focusParts?.[0] ?? null;
  const setFocus = setFocusKey;
  const isChange = view === "change";
  const side = isChange ? "after" : view;
  const rates = useMemo(() => marginalRates(sweep), [sweep]);
  const breakdown = sweep.parts ?? null;
  // The parts in use on either side, so switching views keeps the colours
  const parts = useMemo(
    () => (breakdown && !isChange ? partsInUse([...breakdown.before, ...breakdown.after]) : null),
    [breakdown, isChange],
  );
  const rawRows = useMemo(() => {
    const rows = breakdown
      ? breakdownRows(rates, breakdown, side)
      : rates.map((rate) => ({ income: rate.income, to: rate.to, before: rate.before, after: rate.after }));
    // The last step runs to the sweep's end
    if (!breakdown && rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
    return rows;
  }, [rates, breakdown, side]);
  // The rate axis: below 0% when a total or a part is negative, above 100%
  // when a total is (Pavel's review, HH8: the hover showed negative rates the
  // chart did not), within −100% to 200%
  const rateBounds = useMemo(() => {
    const values = [];
    for (const row of rawRows) {
      values.push(row.before, row.after);
      if (parts) {
        const drawn = parts.map((part) => row[drawnKey(part.name)] ?? 0).concat(row[drawnKey("other")] ?? 0);
        values.push(drawn.filter((v) => v < 0).reduce((a, b) => a + b, 0), drawn.filter((v) => v > 0).reduce((a, b) => a + b, 0));
      }
    }
    return rateAxis(values);
  }, [rawRows, parts]);
  const data = useMemo(() => {
    const clamp = clampTo(rateBounds.domain);
    return rawRows.map((row) => ({
      ...row,
      before: clamp(row.before),
      after: clamp(row.after),
      beforeRaw: row.before,
      afterRaw: row.after,
      change: row.after - row.before,
    }));
  }, [rawRows, rateBounds]);
  const clamp = clampTo(rateBounds.domain);
  // Your own pointer on this card: the salary under it and the step that
  // holds it (a numeric axis snaps to the nearest point, which past a
  // step's middle is the next step), with a guide line (HH9)
  const [pointer, setPointer] = useState(null);
  const title = `Marginal tax rate across earnings, ${yearLabel}`;
  const { domain: xDomain, ticks: xTicks } = sweepAxis(sweep.max);
  // The API's own rates at your salary, else the step that holds it
  const own = sweep.own;
  const yours =
    own && own.beforeRate !== null && own.afterRate !== null
      ? { before: own.beforeRate, after: own.afterRate }
      : salary !== null
        ? rateAt(rates, salary)
        : null;
  // The change's axis covers your own change too (the API's rate at your
  // salary can sit off the sweep's steps)
  const yTicks = isChange
    ? changeRateTicks(Math.max(0, ...data.map((row) => Math.abs(row.change)), yours ? Math.abs(yours.after - yours.before) : 0))
    : rateBounds.ticks;
  const yAxisWidth = axisWidth(yTicks, isChange ? points : pct);
  const clearPointer = () => {
    setPointer(null);
    sync?.setHover(null);
  };
  // The mouse, or a finger on a phone (round 3: no touch handler left the
  // box stuck after a tap)
  const onPointer = (event) => {
    const at = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
    const box = event.currentTarget.getBoundingClientRect();
    const plotW = box.width - yAxisWidth - RIGHT_MARGIN;
    const px = at.clientX - box.left - yAxisWidth;
    if (plotW <= 0 || px < 0 || px > plotW) {
      clearPointer();
      return;
    }
    const income = xDomain[0] + (px / plotW) * (xDomain[1] - xDomain[0]);
    const row = stepAt(data, income);
    if (!row) return;
    setPointer({ income, row, x: at.clientX - box.left, y: at.clientY - box.top, width: box.width, height: box.height });
    sync?.setHover({ income, card: "rate" });
  };
  // A State Pension household whose income tax rate rises sharply at the
  // start of earnings after the policies: an extra allowance that any other
  // income takes away in full (said in plain words in About this chart)
  const firstNet = sweep.netParts?.after?.[0];
  const firstRates = breakdown ? { before: breakdown.before[0]?.income_tax ?? 0, after: breakdown.after[0]?.income_tax ?? 0 } : null;
  const pensionAllowanceCliff =
    (firstNet?.state_pension ?? 0) > 0 &&
    ((own && own.afterRate - own.beforeRate >= 0.1) || (firstRates && firstRates.after - firstRates.before >= 0.05));
  const yourParts = breakdown?.own ? describeParts(breakdown.own.after) : "";
  const legendItems = isChange
    ? [{ label: "Change in marginal rate", color: CHANGE_COLOUR, type: "line" }]
    : parts
      ? [
          ...parts.map((part) => ({ label: part.label, color: part.color, info: part.info })),
          { label: `Total rate ${SIDE_NAME[view]}`, color: TOTAL_COLOUR, type: "line" },
        ]
      : [view === "before" ? LEGEND_ITEMS[0] : LEGEND_ITEMS[1]];
  // The chips: every component both cards share, in one order; those with
  // nothing here disabled, so the two keys line up
  const rateChips = sweepChips(
    "rate",
    new Set((parts ?? []).map((part) => part.name)),
    { label: `Total rate ${SIDE_NAME[view]}`, colour: TOTAL_COLOUR },
    sync?.union ?? null,
  );
  const lineStroke = isChange ? CHANGE_COLOUR : parts ? TOTAL_COLOUR : view === "before" ? BEFORE_COLOUR : AFTER_COLOUR;
  // The rate as money, from the API's own rates only: they are over the
  // next £200, which the sentence scales (a sweep step is too coarse)
  const keep = own ? keepClause(own.beforeRate, own.afterRate, { first: salary === 0 }) : null;

  const csvColumns = [
    { key: "income", label: "Your salary (£)", decimals: 0 },
    { key: "to", label: "To salary (£)", decimals: 0 },
    ...(parts ?? []).map((part) => ({ key: part.name, label: `${part.label}, with the policies`, decimals: 4 })),
    { key: "before", label: "Marginal tax rate, current law", decimals: 4 },
    { key: "after", label: "Marginal tax rate, with the policies", decimals: 4 },
  ];
  const csvRows = rates.map((rate, i) => ({ ...rate, ...(breakdown?.after[i] ?? {}) }));
  const download = {
    chartRef,
    name: `marginal-tax-rate-${yearLabel}`,
    exportOptions: {
      title,
      description: parts
        ? `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, by part with the selected policies, with the total under current law and with them.`
        : `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, under current law and with the selected policies.`,
      legendItems: legendItems.map(({ info, ...item }) => item),
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
    },
    csv: () =>
      buildChartCsv({
        title,
        units: "Share of an extra £1 of salary; from this salary to the next point",
        source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
        columns: csvColumns,
        rows: csvRows,
      }),
  };

  return (
    <div className="card single-year-card single-year-mtr">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="percent" />
            <span className="title-text">{title}</span>
          </h3>
          {yours && (
            <p className="chart-description">
              {/* One sentence: the rate, its parts, then what it means in
                  money (Vahid, 26 October) */}
              {salary === 0
                ? "With no earnings, your marginal tax rate on your first £200 would be "
                : `At ${formatPounds(salary)} your marginal tax rate is `}
              {pct(yours.before) === pct(yours.after)
                ? pct(yours.after)
                : `${pct(yours.before)} under current law and ${pct(yours.after)} with the policies`}
              {keep ? `, so ${keep}.` : "."}
            </p>
          )}
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-view-switch chart-controls">
        {/* The view in the card's Options pill, as on every other page */}
        <ControlBar name={title} options={[{ label: "View", value: view, onChange: setView, options: CHART_VIEWS }]} />
      </div>
      <div
        ref={chartRef}
        className="chart-plot mtr-plot"
        data-view={view}
        style={{ position: "relative" }}
        onMouseMove={onPointer}
        onMouseLeave={clearPointer}
        onTouchStart={onPointer}
        onTouchMove={onPointer}
        onTouchEnd={clearPointer}
        onTouchCancel={clearPointer}
      >
        <ResponsiveContainer width="100%" height={earningsChartHeight(narrow)}>
          <ComposedChart
            data={data}
            margin={{ top: 12, right: RIGHT_MARGIN, left: 0, bottom: 0 }}
            stackOffset="sign"
          >
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="income"
              type="number"
              axisLine={AXIS_LINE}
              tickLine={false}
              tick={TICK_STYLE}
              tickFormatter={formatPoundsShort}
              ticks={xTicks}
              domain={xDomain}
              // As the earnings chart beside it: axis line 44 px from the foot
              height={44}
              label={{
                value: "Employment income",
                position: "insideBottom",
                offset: 4,
                style: AXIS_TITLE_STYLE,
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={TICK_STYLE}
              ticks={yTicks}
              domain={[yTicks[0], yTicks[yTicks.length - 1]]}
              allowDataOverflow
              tickFormatter={isChange ? points : pct}
              width={yAxisWidth}
            />
            {(parts ?? []).filter((part) => !hidden.includes(part.name)).map((part) => (
              <Area
                key={part.name}
                type="stepAfter"
                dataKey={drawnKey(part.name)}
                name={part.label}
                stackId="parts"
                fill={part.color}
                fillOpacity={focusParts ? (focusParts.includes(part.name) ? 0.95 : 0.2) : 0.85}
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
                onMouseEnter={() => setFocus(part.name)}
                onMouseLeave={() => setFocus(null)}
              />
            ))}
            {salary !== null && (
              <ReferenceLine
                x={salary}
                stroke={CHART_COLOURS.text}
                strokeDasharray={REFERENCE_DASH}
                label={{
                  value: yours ? `You: ${isChange ? points(yours.after - yours.before) : pct(yours[view])}` : "You",
                  // Right of the line, as the net income card's "You", clear of
                  // the y axis's top tick; left of it only near the right edge
                  position: salary < xDomain[1] * 0.75 ? "insideTopLeft" : "insideTopRight",
                  fill: CHART_COLOURS.text,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              />
            )}
            {/* 0% in every view: a negative rate or part is drawn below it */}
            <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} />
            {/* The salary under the pointer on this card, or on the net
                income card beside it */}
            {pointer ? (
              <ReferenceLine x={pointer.income} stroke={CHART_COLOURS.noChange} strokeWidth={1} ifOverflow="hidden" />
            ) : (
              sync?.hover &&
              sync.hover.card !== "rate" && <ReferenceLine x={sync.hover.income} stroke={CHART_COLOURS.noChange} strokeWidth={1} ifOverflow="hidden" />
            )}
            {!(parts && hidden.includes("total")) && <Line
              type="stepAfter"
              dataKey={isChange ? "change" : view}
              name={isChange ? "Change" : view === "before" ? "Current law" : "With the policies"}
              stroke={lineStroke}
              strokeWidth={2}
              strokeOpacity={focusKey && focusKey !== "total" ? 0.3 : 1}
              strokeDasharray={view === "before" && !parts ? BEFORE_DASH : undefined}
              dot={isChange ? false : <EdgeMarker bounds={rateBounds.domain} />}
              activeDot={false}
              isAnimationActive={false}
            />}
            {salary !== null && yours && !isChange && (
              <ReferenceDot
                x={salary}
                y={clamp(yours[view])}
                r={5}
                fill={lineStroke}
                stroke={CHART_COLOURS.surface}
                strokeWidth={2}
                ifOverflow="visible"
              />
            )}
            <Customized component={<ChartUnitLabel text={isChange ? "Change in marginal rate" : "Marginal tax rate"} />} />
          </ComposedChart>
        </ResponsiveContainer>
        {pointer && (
          <div
            className="mtr-tooltip"
            style={{
              position: "absolute",
              zIndex: 20,
              pointerEvents: "none",
              // Beside the pointer, below it in the top half and above it in
              // the bottom half, so it never sits over the top of the plot
              // (the 100% tick, the "You" label) while the pointer is lower
              // down (round 3)
              ...(pointer.y < pointer.height / 2 ? { top: pointer.y + 12 } : { bottom: pointer.height - pointer.y + 12 }),
              ...(pointer.x > pointer.width / 2 ? { right: pointer.width - pointer.x + 12 } : { left: pointer.x + 12 }),
            }}
          >
            <RateTooltip active payload={[{ payload: { ...pointer.row, income: Math.round(pointer.income / 100) * 100 } }]} yearLabel={yearLabel} parts={parts} view={view} focusPart={focus} />
          </div>
        )}
      </div>
      <div className="single-year-legend chart-legend">
        {parts && sync?.sharedLegend ? null : parts ? (
          // The parts and the total as chips, as the net income card's
          <SeriesToggle
            lead="Show:"
            label="Parts"
            series={rateChips}
            shown={rateChips.filter((chip) => !chip.disabled && !hiddenKeys.includes(chip.key)).map((chip) => chip.key)}
            onChange={(next) => {
              // This card's chips decide only their own keys; the rest stay as the other card left them
              const mine = rateChips.filter((chip) => !chip.disabled).map((chip) => chip.key);
              setHiddenKeys([...hiddenKeys.filter((key) => !mine.includes(key)), ...mine.filter((key) => !next.includes(key))]);
            }}
            onHover={setFocus}
            collapseDisabled
            expanded={sync?.expanded}
            onExpandedChange={sync?.setExpanded}
            narrow={narrow}
          />
        ) : (
          <GroupedLegend items={legendItems} />
        )}
      </div>
      <div className="card-logo chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {/* The same "About this chart" as the net income card beside it */}
      <div className="chart-footer">
        <ChartMoreInfo
          info={{
            shows: yourParts
              ? `${salary === 0 ? "With no earnings" : `At ${formatPounds(salary)}`}, your marginal rate is made up of ${yourParts}.`
              : "Of each extra pound of salary, the share lost to taxes and withdrawn benefits.",
            how: [
              "Worked out from the same salary sweep as the net income card: one minus the change in net income over the change in salary, from each salary to the next.",
              parts
                ? "Each layer is one tax's or benefit taper's part of the rate; the line is the total rate."
                : "The line is the total rate.",
              "The dashed line marks your salary.",
            ],
            // Each part's note (the Child Benefit clawback, the personal
            // allowance taper), in place of the legend's "i"
            definitions: (parts ?? []).filter((part) => part.info).map((part) => ({ term: part.label, meaning: part.info })),
            method: { anchor: METHOD_ANCHORS.personal, label: "How the household calculation works" },
            caveats: [
              pensionAllowanceCliff &&
                "For a pensioner whose only income is the State Pension, the selected policies add a tax-free allowance. Any earnings take the whole allowance away, so income tax jumps at the first pound earned.",
              "A part that lowers the rate (a benefit rising with pay) is drawn below 0%. A rate beyond the axis is marked at its edge, and the tooltip gives it in full.",
            ],
          }}
        />
      </div>
    </div>
  );
}


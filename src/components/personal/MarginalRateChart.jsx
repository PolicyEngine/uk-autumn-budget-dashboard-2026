import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { keepClause, marginalRates, rateAt } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import SeriesToggle from "../SeriesToggle";
import { AFTER_COLOUR, BEFORE_COLOUR, LEGEND_ITEMS, earningsChartHeight } from "./EarningsChart";
import { breakdownRows, describeParts, drawnKey, partsInUse } from "./marginalRateParts";
import TitleIcon from "../TitleIcon";
import ViewSwitch from "../ViewSwitch";
import { CHART_VIEWS } from "./chartViews";

const Y_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const pct = (value) => `${Math.round(value * 100)}%`;
const clamp = (value) => Math.min(1, Math.max(0, value));
// Over the stacked parts the totals are drawn in ink, the before total dashed
const TOTAL_COLOUR = CHART_COLOURS.ink;
const CHANGE_COLOUR = CHART_COLOURS.ink;
const SIDE_NAME = { before: "before", after: "after" };
const points = (value) => {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}pp`;
};

/** Symmetric ticks for a change in rate: ±4, 10, 20, 50 or 100 points (whole-point halves). */
export function changeRateTicks(maxAbs) {
  const top = [0.04, 0.1, 0.2, 0.5, 1].find((m) => m >= maxAbs) ?? Math.ceil(maxAbs);
  return [-top, -top / 2, 0, top / 2, top];
}

/** A dot only where the rate is off the 0–100% scale: ▲ above, ▼ below. */
function EdgeMarker({ cx, cy, payload, dataKey, stroke }) {
  const raw = payload?.[`${dataKey}Raw`];
  if (raw === undefined || (raw >= 0 && raw <= 1) || cx === undefined) return null;
  const up = raw > 1;
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
  const labelFormat = (value) => `Employment income ${formatPounds(value)}, ${yearLabel}`;
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
export default function MarginalRateChart({ sweep, salary, yearLabel }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const [view, setView] = useState("after");
  // The parts (and the total line) hidden from the chips, and the one a chip
  // or the pointer is on, which comes forward while the rest dim
  const [hidden, setHidden] = useState([]);
  const [focus, setFocus] = useState(null);
  const isChange = view === "change";
  const side = isChange ? "after" : view;
  const rates = useMemo(() => marginalRates(sweep), [sweep]);
  const breakdown = sweep.parts ?? null;
  // The parts in use on either side, so switching views keeps the colours
  const parts = useMemo(
    () => (breakdown && !isChange ? partsInUse([...breakdown.before, ...breakdown.after]) : null),
    [breakdown, isChange],
  );
  const data = useMemo(() => {
    const rows = breakdown
      ? breakdownRows(rates, breakdown, side)
      : rates.map((rate) => ({ income: rate.income, to: rate.to, before: rate.before, after: rate.after }));
    // The last step runs to the sweep's end
    if (!breakdown && rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
    return rows.map((row) => ({
      ...row,
      before: clamp(row.before),
      after: clamp(row.after),
      beforeRaw: row.before,
      afterRaw: row.after,
      change: row.after - row.before,
    }));
  }, [rates, breakdown, side]);
  const yTicks = isChange ? changeRateTicks(Math.max(0, ...data.map((row) => Math.abs(row.change)))) : Y_TICKS;
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
  const yourParts = breakdown?.own ? describeParts(breakdown.own.after) : "";
  const legendItems = isChange
    ? [{ label: "Change in marginal rate", color: CHANGE_COLOUR, type: "line" }]
    : parts
      ? [
          ...parts.map((part) => ({ label: part.label, color: part.color, info: part.info })),
          { label: `Total rate ${SIDE_NAME[view]}`, color: TOTAL_COLOUR, type: "line" },
        ]
      : [view === "before" ? LEGEND_ITEMS[0] : LEGEND_ITEMS[1]];
  const lineStroke = isChange ? CHANGE_COLOUR : parts ? TOTAL_COLOUR : view === "before" ? BEFORE_COLOUR : AFTER_COLOUR;
  // The rate as money, from the API's own rates only: they are over the
  // next £200, which the sentence scales (a sweep step is too coarse)
  const keep = own ? keepClause(own.beforeRate, own.afterRate) : null;

  const csvColumns = [
    { key: "income", label: "Your salary (£)", decimals: 0 },
    { key: "to", label: "To salary (£)", decimals: 0 },
    ...(parts ?? []).map((part) => ({ key: part.name, label: `${part.label} after`, decimals: 4 })),
    { key: "before", label: "Marginal tax rate before", decimals: 4 },
    { key: "after", label: "Marginal tax rate after", decimals: 4 },
  ];
  const csvRows = rates.map((rate, i) => ({ ...rate, ...(breakdown?.after[i] ?? {}) }));
  const download = {
    chartRef,
    name: `marginal-tax-rate-${yearLabel}`,
    exportOptions: {
      title,
      description: parts
        ? `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, by part after the selected policies, with the total before and after.`
        : `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, before and after the selected policies.`,
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
              At {formatPounds(salary)} your marginal tax rate is{" "}
              {pct(yours.before) === pct(yours.after)
                ? pct(yours.after)
                : `${pct(yours.before)} before and ${pct(yours.after)} after`}
              {keep ? `, so ${keep}.` : "."}
            </p>
          )}
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-view-switch chart-controls">
        <ViewSwitch options={CHART_VIEWS} value={view} onChange={setView} label="Marginal rate view" compact />
      </div>
      <div ref={chartRef} className="chart-plot" data-view={view}>
        <ResponsiveContainer width="100%" height={earningsChartHeight(narrow)}>
          <ComposedChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
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
              width={axisWidth(yTicks, isChange ? points : pct)}
            />
            <Tooltip {...TOOLTIP_PROPS} content={<RateTooltip yearLabel={yearLabel} parts={parts} view={view} focusPart={focus} />} />
            {(parts ?? []).filter((part) => !hidden.includes(part.name)).map((part) => (
              <Area
                key={part.name}
                type="stepAfter"
                dataKey={drawnKey(part.name)}
                name={part.label}
                stackId="parts"
                fill={part.color}
                fillOpacity={focus ? (focus === part.name ? 0.95 : 0.2) : 0.85}
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
                  position: "insideTopRight",
                  fill: CHART_COLOURS.text,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              />
            )}
            {isChange && <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} />}
            {!(parts && hidden.includes("total")) && <Line
              type="stepAfter"
              dataKey={isChange ? "change" : view}
              name={isChange ? "Change" : view === "before" ? "Before" : "After"}
              stroke={lineStroke}
              strokeWidth={2}
              strokeOpacity={focus && focus !== "total" ? 0.3 : 1}
              strokeDasharray={view === "before" && !parts ? BEFORE_DASH : undefined}
              dot={isChange ? false : <EdgeMarker />}
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
      </div>
      <div className="single-year-legend chart-legend">
        {parts ? (
          // The parts and the total as chips, as the net income card's
          <SeriesToggle
            lead="Show:"
            label="Parts"
            series={[
              ...parts.map((part) => ({ key: part.name, label: part.label, colour: part.color, shape: "block" })),
              { key: "total", label: `Total rate ${SIDE_NAME[view]}`, colour: TOTAL_COLOUR },
            ]}
            shown={[...parts.map((part) => part.name), "total"].filter((key) => !hidden.includes(key))}
            onChange={(next) => setHidden([...parts.map((part) => part.name), "total"].filter((key) => !next.includes(key)))}
            onHover={setFocus}
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
              ? `At ${formatPounds(salary)}, your marginal rate is made up of ${yourParts}.`
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
            caveats: ["The axis runs from 0% to 100%; a rate beyond either end is marked at the edge, and the tooltip gives it in full."],
          }}
        />
      </div>
    </div>
  );
}


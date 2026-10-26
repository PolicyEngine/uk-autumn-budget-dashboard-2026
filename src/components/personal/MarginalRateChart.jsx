import { useMemo, useRef } from "react";
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
import { marginalRates, rateAt } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import { AFTER_COLOUR, BEFORE_COLOUR, LEGEND_ITEMS, earningsChartHeight } from "./EarningsChart";
import { breakdownRows, describeParts, drawnKey, partsInUse } from "./marginalRateParts";
import TitleIcon from "../TitleIcon";

const Y_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const pct = (value) => `${Math.round(value * 100)}%`;
const clamp = (value) => Math.min(1, Math.max(0, value));
// Over the stacked parts the totals are drawn in ink, the before total dashed
const TOTAL_COLOUR = CHART_COLOURS.ink;
const TOTAL_ITEMS = [
  { label: "Total rate after", color: TOTAL_COLOUR, type: "line" },
  { label: "Total rate before", color: TOTAL_COLOUR, type: "line", dash: BEFORE_DASH },
];

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
 * The shared tooltip with the true rates, not the clipped ones: with the
 * breakdown, each part in use after the policies, then the two totals.
 */
function RateTooltip({ yearLabel, parts, ...props }) {
  const point = props.payload?.[0]?.payload;
  if (!props.active || !point) return null;
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
      labelFormat={(value) => `Salary ${formatPounds(value)}, ${yearLabel}`}
      payload={[
        ...partRows,
        {
          dataKey: "after",
          name: parts ? "Total rate after" : "Marginal rate after",
          value: point.afterRaw,
          color: parts ? TOTAL_COLOUR : AFTER_COLOUR,
        },
        {
          dataKey: "before",
          name: parts ? "Total rate before" : "Marginal rate before",
          value: point.beforeRaw,
          color: parts ? TOTAL_COLOUR : BEFORE_COLOUR,
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
  const rates = useMemo(() => marginalRates(sweep), [sweep]);
  const breakdown = sweep.parts ?? null;
  const parts = useMemo(() => (breakdown ? partsInUse(breakdown.after) : null), [breakdown]);
  const data = useMemo(() => {
    const rows = breakdown
      ? breakdownRows(rates, breakdown)
      : rates.map((rate) => ({ income: rate.income, to: rate.to, before: rate.before, after: rate.after }));
    // The last step runs to the sweep's end
    if (!breakdown && rows.length) rows.push({ ...rows[rows.length - 1], income: rows[rows.length - 1].to });
    return rows.map((row) => ({
      ...row,
      before: clamp(row.before),
      after: clamp(row.after),
      beforeRaw: row.before,
      afterRaw: row.after,
    }));
  }, [rates, breakdown]);
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
  const legendItems = parts
    ? [
        ...parts.map((part) => ({ label: part.label, color: part.color, info: part.info })),
        ...TOTAL_ITEMS,
      ]
    : LEGEND_ITEMS;
  const totalStroke = parts ? TOTAL_COLOUR : null;

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
              At {formatPounds(salary)} your marginal tax rate is {pct(yours.before)} before and{" "}
              {pct(yours.after)} after{yourParts ? `: ${yourParts}.` : "."}
            </p>
          )}
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef} className="chart-plot">
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
                value: `Your salary in ${yearLabel}`,
                position: "insideBottom",
                offset: 4,
                style: AXIS_TITLE_STYLE,
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={TICK_STYLE}
              ticks={Y_TICKS}
              domain={[0, 1]}
              allowDataOverflow
              tickFormatter={pct}
              width={axisWidth(Y_TICKS, pct)}
            />
            <Tooltip {...TOOLTIP_PROPS} content={<RateTooltip yearLabel={yearLabel} parts={parts} />} />
            {(parts ?? []).map((part) => (
              <Area
                key={part.name}
                type="stepAfter"
                dataKey={drawnKey(part.name)}
                name={part.label}
                stackId="parts"
                fill={part.color}
                fillOpacity={0.85}
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
            {salary !== null && (
              <ReferenceLine
                x={salary}
                stroke={CHART_COLOURS.text}
                strokeDasharray={REFERENCE_DASH}
                label={{
                  value: yours ? `You: ${pct(yours.after)}` : "You",
                  position: "insideTopRight",
                  fill: CHART_COLOURS.text,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              />
            )}
            <Line
              type="stepAfter"
              dataKey="before"
              name="Before"
              stroke={totalStroke ?? BEFORE_COLOUR}
              strokeWidth={parts ? 1.5 : 2}
              strokeDasharray={BEFORE_DASH}
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="after"
              name="After"
              stroke={totalStroke ?? AFTER_COLOUR}
              strokeWidth={2}
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            {salary !== null && yours && (
              <ReferenceDot
                x={salary}
                y={clamp(yours.after)}
                r={5}
                fill={totalStroke ?? AFTER_COLOUR}
                stroke={CHART_COLOURS.surface}
                strokeWidth={2}
                ifOverflow="visible"
              />
            )}
            <Customized component={<ChartUnitLabel text="Marginal tax rate" />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="single-year-legend chart-legend">
        <GroupedLegend items={legendItems} />
      </div>
      <div className="card-logo chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}


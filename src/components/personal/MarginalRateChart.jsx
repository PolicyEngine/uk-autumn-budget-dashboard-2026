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
} from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort } from "../../utils/exampleHouseholds";
import { marginalRates, rateAt } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import PillSelect from "../PillSelect";
import { breakdownRows, partsInUse } from "./marginalRateParts";
import "./MarginalRateChart.css";
import { AFTER_COLOUR, BEFORE_COLOUR, LEGEND_ITEMS, earningsChartHeight } from "./EarningsChart";

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const pct = (value) => `${Math.round(value * 100)}%`;
const clamp = (value) => Math.min(1, Math.max(0, value));

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

/** The shared tooltip with the true rates, not the clipped ones. */
function RateTooltip({ yearLabel, ...props }) {
  const point = props.payload?.[0]?.payload;
  if (!props.active || !point) return null;
  return (
    <ChartTooltip
      active
      label={point.income}
      grouped={false}
      showZero
      format={(value) => `${Math.round(value * 100)}%`}
      labelFormat={(value) => `Salary ${formatPounds(value)}, ${yearLabel}`}
      payload={[
        { dataKey: "before", name: "Marginal rate before", value: point.beforeRaw, color: BEFORE_COLOUR },
        { dataKey: "after", name: "Marginal rate after", value: point.afterRaw, color: AFTER_COLOUR },
      ]}
    />
  );
}

/** The breakdown's tooltip: each part after the policies, then both totals. */
function PartsTooltip({ yearLabel, parts, ...props }) {
  const point = props.payload?.[0]?.payload;
  if (!props.active || !point) return null;
  return (
    <ChartTooltip
      active
      label={point.income}
      grouped={false}
      showZero
      format={(value) => `${Math.round(value * 100)}%`}
      labelFormat={(value) => `Salary ${formatPounds(value)}, ${yearLabel}`}
      payload={[
        ...parts
          .filter((part) => Math.abs(point[part.name]) >= 0.0005)
          .map((part) => ({ dataKey: part.name, name: part.label, value: point[part.name], color: part.color })),
        { dataKey: "after", name: "Total after", value: point.after, color: CHART_COLOURS.ink },
        { dataKey: "before", name: "Total before", value: point.before, color: BEFORE_COLOUR },
      ]}
    />
  );
}

/** The breakdown's legend: each part with its note behind an "i", then the totals. */
function PartsLegend({ parts }) {
  return (
    <ul className="mtr-parts-legend" aria-label="Parts of the marginal tax rate">
      {parts.map((part) => (
        <li key={part.name}>
          <span className="mtr-swatch" style={{ background: part.color }} aria-hidden="true" />
          {part.label}
          <span className="info-icon-wrapper">
            <button type="button" className="info-icon" aria-label={`About ${part.label}`}>
              i
            </button>
            <span className="info-tooltip" role="tooltip">
              {part.about}
            </span>
          </span>
        </li>
      ))}
      <li>
        <span className="mtr-line" aria-hidden="true" />
        Total after
      </li>
      <li>
        <span className="mtr-line mtr-line-dashed" aria-hidden="true" />
        Total before
      </li>
    </ul>
  );
}

const VIEWS = [
  { value: "breakdown", label: "Breakdown" },
  { value: "compare", label: "Before vs after" },
];

/**
 * Marginal tax rate across earnings: of each extra pound of salary, the
 * share lost to taxes and withdrawn benefits, from the same sweep as the
 * net income chart (1 − Δnet / Δsalary). With the API's parts, it opens on
 * the breakdown after the policies (stacked by tax and benefit, with both
 * totals); "Before vs after" is the two totals alone, the only view when
 * the API sends no parts. The axis is clipped to 0–100%; a rate past
 * either end is marked at the edge, and the tooltip gives it in full.
 */
export default function MarginalRateChart({ sweep, salary, yearLabel }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const rates = useMemo(() => marginalRates(sweep), [sweep]);
  const hasParts = Boolean(sweep?.parts) && sweep.parts.after.length === rates.length;
  const [chosen, setChosen] = useState("breakdown");
  const view = hasParts ? chosen : "compare";
  const parts = useMemo(() => (hasParts ? partsInUse(sweep.parts.after) : []), [hasParts, sweep]);
  const data = useMemo(() => {
    if (view === "breakdown") {
      return breakdownRows(rates, sweep.parts).map((row) => ({
        ...row,
        beforeRaw: row.before,
        afterRaw: row.after,
        before: clamp(row.before),
        after: clamp(row.after),
      }));
    }
    const rows = rates.map((rate) => ({
      income: rate.income,
      before: clamp(rate.before),
      after: clamp(rate.after),
      beforeRaw: rate.before,
      afterRaw: rate.after,
    }));
    // The last step runs to the sweep's end
    if (rates.length) {
      const last = rates[rates.length - 1];
      rows.push({ ...rows[rows.length - 1], income: last.to });
    }
    return rows;
  }, [rates, view, sweep]);
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
  const breakdown = view === "breakdown";
  const partColumns = parts.map((part) => ({ key: part.name, label: `${part.label} (after)`, decimals: 4 }));

  const download = {
    chartRef,
    name: `marginal-tax-rate-${yearLabel}`,
    exportOptions: {
      title,
      description: breakdown
        ? `Share of each extra pound of salary lost to each tax and withdrawn benefit in ${yearLabel}, after the selected policies, with the total before and after.`
        : `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, before and after the selected policies.`,
      legendItems: breakdown
        ? [
            ...parts.map((part) => ({ label: part.label, color: part.color })),
            { label: "Total after", color: CHART_COLOURS.ink, type: "line" },
            { label: "Total before", color: BEFORE_COLOUR, type: "line", dash: "6 4" },
          ]
        : LEGEND_ITEMS,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
    },
    csv: () =>
      buildChartCsv({
        title,
        units: "Share of an extra £1 of salary; from this salary to the next point",
        source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
        columns: [
          { key: "income", label: "Your salary (£)", decimals: 0 },
          { key: "to", label: "To salary (£)", decimals: 0 },
          { key: "before", label: "Marginal tax rate before", decimals: 4 },
          { key: "after", label: "Marginal tax rate after", decimals: 4 },
          ...(hasParts ? partColumns : []),
        ],
        rows: hasParts ? breakdownRows(rates, sweep.parts).slice(0, -1) : rates,
      }),
  };

  return (
    <div className="card single-year-card single-year-mtr">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          {yours && (
            <p className="chart-description">
              At {formatPounds(salary)} your marginal tax rate is {pct(yours.before)} before and{" "}
              {pct(yours.after)} after.
            </p>
          )}
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      {hasParts && (
        <div className="chart-controls">
          <PillSelect
            variant="light"
            prefix="Show"
            name="Marginal tax rate shown"
            value={view}
            onChange={setChosen}
            options={VIEWS}
            stableWidth
          />
        </div>
      )}
      <div ref={chartRef} className="chart-plot">
        <ResponsiveContainer width="100%" height={earningsChartHeight(narrow)}>
          <ComposedChart data={data} stackOffset="sign" margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
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
            <Tooltip
              {...TOOLTIP_PROPS}
              content={
                breakdown ? (
                  <PartsTooltip yearLabel={yearLabel} parts={parts} />
                ) : (
                  <RateTooltip yearLabel={yearLabel} />
                )
              }
            />
            {salary !== null && (
              <ReferenceLine
                x={salary}
                stroke={CHART_COLOURS.text}
                strokeDasharray="4 3"
                label={
                  breakdown
                    ? undefined
                    : { value: "You", position: "insideTopRight", fill: CHART_COLOURS.text, fontSize: 13, fontWeight: 600 }
                }
              />
            )}
            {breakdown &&
              parts.map((part) => (
                <Area
                  key={part.name}
                  type="stepAfter"
                  dataKey={part.name}
                  name={part.label}
                  stackId="parts"
                  stroke="none"
                  fill={part.color}
                  fillOpacity={0.9}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
            <Line
              type="stepAfter"
              dataKey="before"
              name="Before"
              stroke={BEFORE_COLOUR}
              strokeWidth={breakdown ? 1.5 : 2}
              strokeDasharray="6 4"
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="after"
              name="After"
              stroke={breakdown ? CHART_COLOURS.ink : AFTER_COLOUR}
              strokeWidth={breakdown ? 1.5 : 2}
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            {breakdown && salary !== null && yours && (
              <ReferenceDot
                x={salary}
                y={clamp(yours.after)}
                r={5}
                fill={CHART_COLOURS.ink}
                stroke={CHART_COLOURS.surface}
                strokeWidth={2}
                label={{
                  value: `You: ${pct(yours.after)}`,
                  position: "top",
                  offset: 10,
                  fill: CHART_COLOURS.ink,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              />
            )}
            <Customized component={<ChartUnitLabel text="Marginal tax rate" />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="single-year-legend chart-legend">
        {breakdown ? <PartsLegend parts={parts} /> : <GroupedLegend items={LEGEND_ITEMS} />}
      </div>
      <div className="card-logo chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}

import { useMemo, useRef } from "react";
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
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
import { formatPounds, formatPoundsShort, roundTicks } from "../../utils/exampleHouseholds";
import { keepSentence, marginalRates, rateAt } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import { AFTER_COLOUR, BEFORE_COLOUR, LEGEND_ITEMS, earningsChartHeight } from "./EarningsChart";
import TitleIcon from "../TitleIcon";

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
      labelFormat={(value) => `Employment income ${formatPounds(value)}, ${yearLabel}`}
      payload={[
        { dataKey: "before", name: "Marginal rate before", value: point.beforeRaw, color: BEFORE_COLOUR },
        { dataKey: "after", name: "Marginal rate after", value: point.afterRaw, color: AFTER_COLOUR },
      ]}
    />
  );
}

/**
 * Marginal tax rate across earnings, before and after: of each extra
 * pound of salary, the share lost to taxes and withdrawn benefits, from
 * the same sweep as the net income chart (1 − Δnet / Δsalary). The axis
 * is clipped to 0–100%; a rate past either end is marked at the edge, and
 * the tooltip gives it in full.
 */
export default function MarginalRateChart({ sweep, salary, yearLabel }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const rates = useMemo(() => marginalRates(sweep), [sweep]);
  const data = useMemo(() => {
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
  }, [rates]);
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
  // The rate as money, from the API's own rates only: they are over the
  // next £100, which the sentence scales (a sweep step is too coarse)
  const keep = own ? keepSentence(own.beforeRate, own.afterRate) : null;

  const download = {
    chartRef,
    name: `marginal-tax-rate-${yearLabel}`,
    exportOptions: {
      title,
      description: `Share of each extra pound of salary lost to taxes and withdrawn benefits in ${yearLabel}, before and after the selected policies.`,
      legendItems: LEGEND_ITEMS,
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
        ],
        rows: rates,
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
              {pct(yours.after)} after.
              {keep && (
                <>
                  <br />
                  {keep}
                </>
              )}
            </p>
          )}
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef} className="chart-plot">
        <ResponsiveContainer width="100%" height={earningsChartHeight(narrow)}>
          <LineChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
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
              ticks={Y_TICKS}
              domain={[0, 1]}
              allowDataOverflow
              tickFormatter={pct}
              width={axisWidth(Y_TICKS, pct)}
            />
            <Tooltip {...TOOLTIP_PROPS} content={<RateTooltip yearLabel={yearLabel} />} />
            {salary !== null && (
              <ReferenceLine
                x={salary}
                stroke={CHART_COLOURS.text}
                strokeDasharray={REFERENCE_DASH}
                label={{ value: "You", position: "insideTopRight", fill: CHART_COLOURS.text, fontSize: 13, fontWeight: 600 }}
              />
            )}
            <Line
              type="stepAfter"
              dataKey="before"
              name="Before"
              stroke={BEFORE_COLOUR}
              strokeWidth={2}
              strokeDasharray={BEFORE_DASH}
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="after"
              name="After"
              stroke={AFTER_COLOUR}
              strokeWidth={2}
              dot={<EdgeMarker />}
              activeDot={false}
              isAnimationActive={false}
            />
            <Customized component={<ChartUnitLabel text="Marginal tax rate" />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="single-year-legend chart-legend">
        <GroupedLegend items={LEGEND_ITEMS} />
      </div>
      <div className="card-logo chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}

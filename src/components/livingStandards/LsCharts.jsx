import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { CHART_LOGO } from "../../utils/chartLogo";
import useElementWidth from "../../hooks/useElementWidth";
import {
  barShape,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  GRID_PROPS,
  TICK_STYLE,
  axisWidth,
  useNarrowViewport,
  CHART_COLOURS,
  fiscalYearTicks,
  HOVER_CURSOR,
} from "../../utils/chartTheme";
import { fyLabel } from "../../utils/livingStandards/outlook";

// The base year a thinned fiscal axis always labels (meta.headline_start_year)
const BASE_YEAR = 2027;

/** Lines on one chart differ in pattern as well as colour. */
export const dashOf = (s) => s.dash ?? (s.dashed ? "8 4" : undefined);

/** Legend items for a line chart's series (GroupedLegend and the exports). */
export const lineLegendItems = (series) =>
  series.filter((s) => !s.hidden).map((s) => ({ label: s.name, color: s.colour, type: "line", dash: dashOf(s) }));

// Width a calendar-year tick needs; below it every other year is labelled
const SHORT_YEAR_TICK = 38;

/**
 * X-axis ticks that fit the plot. Fiscal years: full, short, or every
 * other. Other labels (calendar years): every one, or every other.
 */
function xTicksFor({ width, data, xKey, yAxisWidth, fiscal, xFormat, base }) {
  const count = data.length;
  const perTick = count ? Math.max(0, width - yAxisWidth - 8) / count : 0;
  if (!fiscal) return { tickFormatter: xFormat, interval: !width || perTick >= SHORT_YEAR_TICK ? 0 : 1 };
  // Fiscal years: always the full "2027-28", thinned to every second or
  // third year (keeping the first, the last and the base year) where the
  // plot is too narrow for all of them
  const years = data.map((d) => d[xKey]);
  const plotWidth = width ? Math.max(0, width - yAxisWidth - MARGIN.right) : 0;
  return { tickFormatter: fyLabel, ticks: fiscalYearTicks(years, plotWidth, { base }), interval: 0 };
}

// The shared axisWidth sizes digits; "%", "£" and "−" are wider, so give
// the ticks a little more room.
// The unit sits above the plot (ChartUnitLabel horizontal), so the axis
// keeps no gutter for a rotated title.
const tickWidth = (ticks, format) => axisWidth(ticks?.length ? ticks : [0], format, { title: false }) + 12;

// The plot's least height. Room for an x-axis title is kept only when a
// chart has one, so the legend sits 12-16px under the axis.
const X_AXIS_HEIGHT = 26;
const X_TITLE_HEIGHT = 18;
// Shorter on a phone, where the forecast charts stack ten deep
const plotHeight = (narrow) => (narrow ? 210 : 300);
// Room for the unit label above the plot, and for the last x tick at the right
const MARGIN = { top: 28, right: 30, left: 0, bottom: 0 };

/**
 * The card rows a chart fills: the plot, then its legend, then the logo
 * (each its own row, so two cards side by side keep them level). The plot
 * is at least `height` tall and fills its row, so beside a taller plot
 * (a dot plot with many rows) its x axis still sits on the same line.
 */
/**
 * A light-to-dark key for many ordered groups ("Lowest income → Highest
 * income"), in place of a swatch per group.
 */
function RampLegend({ ramp }) {
  return (
    <div className="ls-ramp-legend">
      <span>{ramp.from}</span>
      <span
        className="ls-ramp-bar"
        aria-hidden="true"
        style={{ background: `linear-gradient(to right, ${ramp.colours.join(", ")})` }}
      />
      <span>{ramp.to}</span>
    </div>
  );
}

/** One bar's tooltip: "2031-32 · 15th of 20 (70th–75th percentile)" and its value. */
function BarTooltip({ active, payload, describe }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const { label, value, colour } = describe(String(entry.dataKey), entry.payload);
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: colour ?? entry.color }} />
        <span className="chart-tooltip-value">{value}</span>
      </div>
    </div>
  );
}

export function ChartRows({ plotRef, children, legendItems, height, legendNote = null, ramp = null, legend = true }) {
  return (
    <>
      <div className="chart-plot ls-plot-fill" ref={plotRef} style={{ minHeight: height }}>
        <div className="ls-plot-canvas">{children}</div>
      </div>
      {/* A chart whose lines are labelled on the plot has no key */}
      {legend && (
        <div className="chart-legend">
          {ramp ? <RampLegend ramp={ramp} /> : <GroupedLegend items={legendItems} />}
          {/* A line on what the chart leaves out, under the key */}
          {legendNote && <p className="ls-legend-note">{legendNote}</p>}
        </div>
      )}
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </>
  );
}

// Room right of the plot for direct labels, and their least spacing
const END_LABEL_WIDTH = 150;
const END_LABEL_GAP = 14;

/**
 * Each line's name at its last point, right of the plot, nudged apart so
 * close lines' labels never overlap (a thin leader joins a moved label to
 * its line). Drawn in the chart's SVG, so the downloads carry it.
 */
function EndLabels({ xAxisMap, yAxisMap, data, series, xKey }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const labels = series
    .map((s) => {
      const last = [...data].reverse().find((d) => d[s.key] != null);
      if (!last) return null;
      const x = xAxis.scale(last[xKey]) + (xAxis.scale.bandwidth?.() ?? 0) / 2;
      const y = yAxis.scale(last[s.key]);
      return { key: s.key, name: s.name, colour: s.colour, x, y, at: y };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  // Push each label down clear of the one above, then back up from the
  // bottom so the stack stays inside the plot
  for (let i = 1; i < labels.length; i += 1) labels[i].at = Math.max(labels[i].at, labels[i - 1].at + END_LABEL_GAP);
  const bottom = yAxis.y + yAxis.height;
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const limit = i === labels.length - 1 ? bottom : labels[i + 1].at - END_LABEL_GAP;
    labels[i].at = Math.min(labels[i].at, limit);
  }
  return (
    <g className="ls-end-labels">
      {labels.map((l) => (
        <g key={l.key}>
          {Math.abs(l.at - l.y) > 2 && (
            <path d={`M${l.x + 5},${l.y} L${l.x + 12},${l.at}`} stroke={l.colour} strokeWidth={1} fill="none" />
          )}
          <text x={l.x + 14} y={l.at} dy="0.35em" fontSize={12} fontWeight={600} fill={l.colour}>
            {l.name}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * Line chart in the dashboard's chart theme: light horizontal grid, the
 * unit above the plot, the shared tooltip, and the shared legend and the
 * logo in the card's rows below the plot.
 *
 * series: [{ key, name, colour, dash?, dashed?, hidden? }]. Hidden series
 * are not drawn.
 */
export function LsLineChart({
  data,
  series,
  xKey = "year",
  xFormat = fyLabel,
  yFormat = (v) => v,
  tooltipFormat = yFormat,
  showPlus = false,
  yLabel,
  yDomain,
  yTicks,
  baseYear = BASE_YEAR,
  // [from, to]: the years a card's sentence compares, shaded on the chart
  highlight = null,
  // Name each line at its end, right of the plot (wide screens only; the
  // legend names them on a phone)
  endLabels = false,
  // False where the card's own chips (SeriesToggle) are the key
  legend = true,
  // The key of a line to bring forward (a hovered chip); the others fade
  focusKey = null,
}) {
  const narrow = useNarrowViewport();
  const [ref, width] = useElementWidth();
  const visible = series.filter((s) => !s.hidden);
  const labelled = endLabels && !narrow && width >= 560;
  const margin = labelled ? { ...MARGIN, right: END_LABEL_WIDTH } : MARGIN;
  // Rows key years by their start (2028) or as "2028-29"; match either
  const asKey = (fy) => (typeof data[0]?.[xKey] === "number" ? Number(String(fy).slice(0, 4)) : fy);
  const band = highlight ? highlight.map(asKey) : null;
  const shaded = band && data.some((d) => d[xKey] === band[0]) && data.some((d) => d[xKey] === band[1]);
  const yWidth = tickWidth(yTicks, yFormat);
  const xTicks = xTicksFor({ width, data, xKey, yAxisWidth: yWidth, fiscal: xFormat === fyLabel, xFormat, base: baseYear });

  return (
    <ChartRows plotRef={ref} legendItems={lineLegendItems(visible)} height={plotHeight(narrow)} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={margin}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey={xKey}
            tick={TICK_STYLE}
            axisLine={AXIS_LINE}
            tickLine={false}
            height={X_AXIS_HEIGHT}
            // The first year clear of the y axis's 0 label
            padding={{ left: 12, right: 4 }}
            tickMargin={6}
            {...xTicks}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={yFormat}
            tick={TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={yWidth}
            allowDecimals
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            content={<ChartTooltip format={tooltipFormat} labelFormat={xFormat} grouped={false} showPlus={showPlus} />}
          />
          {shaded && (
            <ReferenceArea
              x1={band[0]}
              x2={band[1]}
              fill={CHART_COLOURS.highlightBand}
              fillOpacity={0.7}
              stroke="none"
              ifOverflow="extendDomain"
            />
          )}
          {visible.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.colour}
              strokeWidth={focusKey === s.key ? 3.5 : 2.5}
              strokeOpacity={focusKey && focusKey !== s.key ? 0.2 : 1}
              strokeDasharray={dashOf(s)}
              dot={{ r: 3, fill: s.colour, stroke: s.colour, strokeWidth: 1, fillOpacity: focusKey && focusKey !== s.key ? 0.2 : 1 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <Customized component={<ChartUnitLabel text={yLabel} horizontal />} />
          {labelled && <Customized component={<EndLabels data={data} series={visible} xKey={xKey} />} />}
        </LineChart>
      </ResponsiveContainer>
    </ChartRows>
  );
}

/**
 * Bar chart in the same theme. Bars stack when `stacked`; with
 * `signColours` a single series is coloured by sign, with `cellColours`
 * (one per row) a single series is coloured by category, and
 * `legendItems` names the colours. Several series side by side are
 * grouped bars; `barGap` and `maxBarSize` set their spacing.
 */
export function LsBarChart({
  data,
  series,
  xKey = "year",
  xFormat = fyLabel,
  xLabel,
  yFormat = (v) => v,
  tooltipFormat = yFormat,
  showPlus = false,
  yLabel,
  yDomain,
  yTicks,
  stacked = false,
  signColours = null,
  legendItems,
  baseYear = BASE_YEAR,
  cellColours = null,
  barGap = 4,
  barCategoryGap = "20%",
  maxBarSize = 56,
  tooltipLabelFormat = null,
  legendNote = null,
  // { colours, from, to }: a light-to-dark key in place of the swatches
  ramp = null,
  // (seriesKey, row) => { label, value, colour? }: a tooltip for the one
  // bar hovered (its series dimmed others), in place of the year's list
  describeBar = null,
  // A faint band behind every other category, so each year's cluster of
  // bars reads as its own group
  categoryBands = false,
}) {
  const narrow = useNarrowViewport();
  const [hovered, setHovered] = useState(null);
  const [ref, width] = useElementWidth();
  const yWidth = tickWidth(yTicks, yFormat);
  const xTicks = xTicksFor({ width, data, xKey, yAxisWidth: yWidth, fiscal: xFormat === fyLabel, xFormat, base: baseYear });
  const items = legendItems ?? series.map((s) => ({ label: s.name, color: s.colour }));

  return (
    <ChartRows plotRef={ref} legendItems={items} height={plotHeight(narrow)} legendNote={legendNote} ramp={ramp}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={MARGIN} barCategoryGap={barCategoryGap} barGap={barGap}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey={xKey}
            tick={TICK_STYLE}
            axisLine={AXIS_LINE}
            tickLine={false}
            {...xTicks}
            height={X_AXIS_HEIGHT + (xLabel ? X_TITLE_HEIGHT : 0)}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: 4, style: AXIS_TITLE_STYLE } : undefined}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={yFormat}
            tick={TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={yWidth}
            allowDecimals
          />
          {categoryBands &&
            data
              .filter((_, i) => i % 2 === 0)
              .map((d) => (
                <ReferenceArea
                  key={`band-${d[xKey]}`}
                  x1={d[xKey]}
                  x2={d[xKey]}
                  fill={CHART_COLOURS.mutedFill}
                  fillOpacity={0.8}
                  stroke="none"
                />
              ))}
          <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
          {describeBar ? (
            // Beside the bar, never over the year's other bars
            <Tooltip
              {...TOOLTIP_PROPS}
              shared={false}
              cursor={false}
              offset={16}
              // On a phone, under the plot, so it never covers the bars
              {...(narrow ? { position: { x: 0, y: plotHeight(narrow) - 8 }, allowEscapeViewBox: { x: false, y: true } } : {})}
              content={<BarTooltip describe={describeBar} />}
            />
          ) : (
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={HOVER_CURSOR}
              content={<ChartTooltip format={tooltipFormat} labelFormat={tooltipLabelFormat ?? xFormat} grouped={false} showPlus={showPlus} />}
            />
          )}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.colour}
              onMouseEnter={describeBar ? (_, index) => setHovered({ key: s.key, index }) : undefined}
              onMouseLeave={describeBar ? () => setHovered(null) : undefined}
              stackId={stacked ? "stack" : undefined}
              shape={barShape(stacked ? series.map((item) => item.key) : [s.key])}
              maxBarSize={maxBarSize}
              isAnimationActive={false}
            >
              {cellColours && data.map((d, i) => <Cell key={i} fill={cellColours[i]} />)}
              {/* The hovered bar stays full, every other bar dims */}
              {describeBar &&
                !cellColours &&
                data.map((d, i) => (
                  <Cell key={i} fill={s.colour} fillOpacity={hovered && (hovered.key !== s.key || hovered.index !== i) ? 0.3 : 1} />
                ))}
              {signColours &&
                data.map((d, i) => (
                  <Cell key={i} fill={(d[s.key] ?? 0) < 0 ? signColours.negative : signColours.positive} />
                ))}
            </Bar>
          ))}
          <Customized component={<ChartUnitLabel text={yLabel} horizontal />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartRows>
  );
}

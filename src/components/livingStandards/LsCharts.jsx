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
function ChartRows({ plotRef, children, legendItems, height }) {
  return (
    <>
      <div className="chart-plot ls-plot-fill" ref={plotRef} style={{ minHeight: height }}>
        <div className="ls-plot-canvas">{children}</div>
      </div>
      <div className="chart-legend">
        <GroupedLegend items={legendItems} />
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </>
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
}) {
  const narrow = useNarrowViewport();
  const [ref, width] = useElementWidth();
  const visible = series.filter((s) => !s.hidden);
  // Rows key years by their start (2028) or as "2028-29"; match either
  const asKey = (fy) => (typeof data[0]?.[xKey] === "number" ? Number(String(fy).slice(0, 4)) : fy);
  const band = highlight ? highlight.map(asKey) : null;
  const shaded = band && data.some((d) => d[xKey] === band[0]) && data.some((d) => d[xKey] === band[1]);
  const yWidth = tickWidth(yTicks, yFormat);
  const xTicks = xTicksFor({ width, data, xKey, yAxisWidth: yWidth, fiscal: xFormat === fyLabel, xFormat, base: baseYear });

  return (
    <ChartRows plotRef={ref} legendItems={lineLegendItems(visible)} height={plotHeight(narrow)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
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
              strokeWidth={2.5}
              strokeDasharray={dashOf(s)}
              dot={{ r: 3, fill: s.colour, stroke: s.colour, strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <Customized component={<ChartUnitLabel text={yLabel} horizontal />} />
        </LineChart>
      </ResponsiveContainer>
    </ChartRows>
  );
}

/**
 * Bar chart in the same theme. Bars stack when `stacked`; with
 * `signColours` a single series is coloured by sign, and `legendItems`
 * names the colours.
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
}) {
  const narrow = useNarrowViewport();
  const [ref, width] = useElementWidth();
  const yWidth = tickWidth(yTicks, yFormat);
  const xTicks = xTicksFor({ width, data, xKey, yAxisWidth: yWidth, fiscal: xFormat === fyLabel, xFormat, base: baseYear });
  const items = legendItems ?? series.map((s) => ({ label: s.name, color: s.colour }));

  return (
    <ChartRows plotRef={ref} legendItems={items} height={plotHeight(narrow)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={MARGIN} barCategoryGap="20%">
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
          <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
          <Tooltip
            {...TOOLTIP_PROPS}
            cursor={HOVER_CURSOR}
            content={<ChartTooltip format={tooltipFormat} labelFormat={xFormat} grouped={false} showPlus={showPlus} />}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.colour}
              stackId={stacked ? "stack" : undefined}
              maxBarSize={56}
              isAnimationActive={false}
            >
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

// The OBR forecasts chart: the ONS outturn as a solid line, each earlier
// OBR forecast as a thin dashed line from where it was made, the newest
// forecast as a bold dashed line, the start, latest and end points
// labelled, and a brush under the x axis to choose the periods shown.
// Draws a view from utils/forecastVintages/view.js; the card around it is
// ForecastVintagesTab's.

import {
  Brush,
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import GroupedLegend from "../GroupedLegend";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { CHART_LOGO } from "../../utils/chartLogo";
import {
  AXIS_LINE,
  CHART_COLOURS,
  GRID_PROPS,
  TICK_STYLE,
  TOOLTIP_CONTENT_STYLE,
  axisWidth,
  useNarrowViewport,
} from "../../utils/chartTheme";
import { OUTTURN_KEY, niceAxis, stepDecimals } from "../../utils/forecastVintages/view";

// The lines differ in pattern and weight as well as colour
export const LINE_STYLE = {
  outturn: { colour: CHART_COLOURS.gain, width: 2.5, dash: undefined },
  newest: { colour: CHART_COLOURS.highlight, width: 3, dash: "8 4" },
  past: { colour: CHART_COLOURS.vintage, width: 1.25, dash: "4 3" },
};

// Where each labelled point's value sits: start under the line, latest
// and end over it, end's text ending at its point so it stays in the plot
const POINT_LABEL = {
  start: { caption: "start", above: false, anchor: "middle" },
  latest: { caption: "latest", above: true, anchor: "middle" },
  end: { caption: "end", above: true, anchor: "end" },
};

// Room above the plot for the unit label and the labelled points' values
const MARGIN = { top: 56, right: 24, left: 0, bottom: 0 };
const BRUSH_HEIGHT = 26;
// Earlier forecasts listed by name in the tooltip, newest first
const TOOLTIP_FORECASTS = 6;

/** The legend's items: what is drawn (also the downloads' legend). */
export function legendItems(view, showPast) {
  const items = [
    { label: "Outturn", color: LINE_STYLE.outturn.colour, type: "line" },
    {
      label: `${view.newest.label} forecast`,
      color: LINE_STYLE.newest.colour,
      type: "line",
      dash: LINE_STYLE.newest.dash,
    },
  ];
  if (showPast && view.vintages.length > 1) {
    items.push({ label: "Earlier forecasts", color: LINE_STYLE.past.colour, type: "line", dash: LINE_STYLE.past.dash });
  }
  return items;
}

/** X-axis ticks at the start of whole years, at most eight across the rows. */
export function xTicks(rows, frequency) {
  if (!rows.length) return [];
  const perYear = frequency === "quarterly" ? 4 : 1;
  const first = Math.ceil(rows[0].x / perYear);
  const last = Math.floor(rows[rows.length - 1].x / perYear);
  const years = last - first + 1;
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => years / s <= 8) ?? 50;
  const ticks = [];
  for (let y = Math.ceil(first / step) * step; y <= last; y += step) ticks.push(y * perYear);
  return ticks;
}

/** The y axis over the rows shown: round steps, from 0 for a % view. */
export function yAxisFor(view, rows) {
  const keys = [OUTTURN_KEY, ...view.vintages.map((v) => v.key)];
  const values = rows.flatMap((row) => keys.map((key) => row[key]).filter((v) => v != null));
  if (!values.length) return null;
  return niceAxis(Math.min(...values), Math.max(...values), { zero: view.unit === "pct" });
}

/**
 * A labelled point's text: a short leader line from the dot, the value in
 * large type and what it is ("start", "latest", "end") under it. Recharts
 * passes the dot's box as viewBox.
 */
function PointLabel({ viewBox, value, caption, above, anchor, narrow }) {
  if (!viewBox) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2;
  const sign = above ? -1 : 1;
  const lineEnd = cy + sign * (narrow ? 14 : 20);
  const valueSize = narrow ? 13 : 15;
  // The value nearest the line, its caption beyond it
  const valueY = above ? lineEnd - 20 : lineEnd + valueSize + 2;
  const captionY = valueY + 14;
  return (
    <g className="fv-point-label">
      <line x1={cx} y1={cy + sign * 6} x2={cx} y2={lineEnd} stroke={CHART_COLOURS.text} strokeWidth={1} />
      <text x={cx} y={valueY} textAnchor={anchor} fontSize={valueSize} fontWeight={700} fill={CHART_COLOURS.ink}>
        {value}
      </text>
      <text x={cx} y={captionY} textAnchor={anchor} fontSize={11} fill={CHART_COLOURS.axisTitle}>
        {caption}
      </text>
    </g>
  );
}

/** The hovered period: outturn, the newest forecast, then earlier ones. */
function VintageTooltip({ active, payload, label, view }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const earlier = view.vintages.filter((v) => !v.newest && row[v.key] != null).reverse();
  const listed = earlier.slice(0, TOOLTIP_FORECASTS);
  return (
    <div className="fv-tooltip" style={TOOLTIP_CONTENT_STYLE}>
      <p className="fv-tooltip-period">{view.label(label)}</p>
      {row[OUTTURN_KEY] != null && (
        <p>
          Outturn: <strong>{view.format(row[OUTTURN_KEY])}</strong>
        </p>
      )}
      {row[view.newest.key] != null && (
        <p>
          {view.newest.label} forecast: <strong>{view.format(row[view.newest.key])}</strong>
        </p>
      )}
      {listed.map((v) => (
        <p key={v.key} className="fv-tooltip-earlier">
          {v.label} forecast: {view.format(row[v.key])}
        </p>
      ))}
      {earlier.length > listed.length && (
        <p className="fv-tooltip-earlier">and {earlier.length - listed.length} earlier forecasts</p>
      )}
    </div>
  );
}

/**
 * The chart's plot, legend and logo rows (LsCard's children). `range` is
 * the [first, last] row shown, which the brush sets through `onRange`;
 * `chartKey` changes when the rows do, so the brush starts again on them.
 */
export default function VintageChart({ view, showPast, range, onRange, chartKey }) {
  const narrow = useNarrowViewport();
  const [lo, hi] = range;
  const shownRows = view.rows.slice(lo, hi + 1);
  const axis = yAxisFor(view, shownRows) ?? niceAxis(0, 1);
  const decimals = stepDecimals(axis.step);
  const tickFormat = (v) => view.format(v, decimals);
  const yWidth = axisWidth(axis.ticks, tickFormat, { title: false }) + 12;
  const ticks = xTicks(shownRows, view.frequency);
  // Quarterly ticks name the year only: each sits at its first quarter
  const tickLabel = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
  const first = shownRows[0]?.x;
  const last = shownRows[shownRows.length - 1]?.x;
  const points = view.points.filter((p) => p.x >= first && p.x <= last);
  const past = view.vintages.filter((v) => !v.newest);
  const newest = view.vintages.find((v) => v.newest);

  return (
    <>
      <div className="chart-plot ls-plot-fill fv-plot" style={{ minHeight: narrow ? 340 : 440 }}>
        <div className="ls-plot-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={chartKey} data={view.rows} margin={MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="x"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={ticks}
                interval={0}
                tickFormatter={tickLabel}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickMargin={6}
              />
              <YAxis
                domain={axis.domain}
                ticks={axis.ticks}
                tickFormatter={tickFormat}
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                width={yWidth}
                allowDataOverflow
              />
              <Tooltip content={<VintageTooltip view={view} />} isAnimationActive={false} />
              {showPast &&
                past.map((v) => (
                  <Line
                    key={v.key}
                    dataKey={v.key}
                    name={`${v.label} forecast`}
                    stroke={LINE_STYLE.past.colour}
                    strokeWidth={LINE_STYLE.past.width}
                    strokeDasharray={LINE_STYLE.past.dash}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              {newest && (
                <Line
                  dataKey={newest.key}
                  name={`${newest.label} forecast`}
                  stroke={LINE_STYLE.newest.colour}
                  strokeWidth={LINE_STYLE.newest.width}
                  strokeDasharray={LINE_STYLE.newest.dash}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
              {/* Outturn last, so it is drawn over the forecasts */}
              <Line
                dataKey={OUTTURN_KEY}
                name="Outturn"
                stroke={LINE_STYLE.outturn.colour}
                strokeWidth={LINE_STYLE.outturn.width}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {points.map((p) => (
                <ReferenceDot
                  key={p.role}
                  x={p.x}
                  y={p.y}
                  r={4.5}
                  fill={p.role === "end" ? LINE_STYLE.newest.colour : LINE_STYLE.outturn.colour}
                  stroke={CHART_COLOURS.surface}
                  strokeWidth={1.5}
                  ifOverflow="discard"
                  label={<PointLabel value={view.format(p.y)} narrow={narrow} {...POINT_LABEL[p.role]} />}
                />
              ))}
              <Brush
                dataKey="x"
                height={BRUSH_HEIGHT}
                startIndex={lo}
                endIndex={hi}
                travellerWidth={8}
                alwaysShowText
                stroke={CHART_COLOURS.highlight}
                fill={CHART_COLOURS.surface}
                tickFormatter={(x) => view.label(x)}
                onChange={({ startIndex, endIndex }) => onRange([startIndex, endIndex])}
              />
              <Customized component={<ChartUnitLabel text={view.axisLabel} horizontal />} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-legend">
        <GroupedLegend items={legendItems(view, showPast)} />
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </>
  );
}

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
import useElementWidth from "../../hooks/useElementWidth";
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
// A label lifted clear of the one it would overlap moves this far, and
// the y axis then keeps this share of its range free above the data
const LABEL_LIFT = 34;
const LIFT_HEADROOM = 0.3;
// The labels' text widths, estimated: bold value digits at 15px (13px on
// a phone), with a little space between labels
const VALUE_CHAR = { wide: 8.8, narrow: 7.6 };
const CAPTION_CHAR = 6.2;
const LABEL_GAP = 6;
// How far a label's text reaches from its dot, up or down: the leader line
// and the two lines of text (PointLabel)
const LABEL_REACH = { wide: 54, narrow: 48 };

// Room above the plot for the unit label and the labelled points' values
const MARGIN = { top: 56, right: 24, left: 0, bottom: 0 };
const BRUSH_HEIGHT = 26;
// The chart's height, and roughly the plot's within it (less the margin,
// the x axis and the brush): enough to keep labels off the other dots
const CHART_HEIGHT = { wide: 440, narrow: 340 };
const PLOT_HEIGHT = { wide: 440 - 56 - 30 - 26, narrow: 340 - 56 - 30 - 26 };
// Room right of the brush for its end label ("Q1 2031"), which Recharts
// draws beyond the right-hand handle
const BRUSH_END_LABEL = 52;
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

/**
 * The y axis over the rows shown: round steps, from 0 for a % view, with
 * `headroom` (a share of the range) kept free above the data.
 */
export function yAxisFor(view, rows, { headroom = 0 } = {}) {
  const keys = [OUTTURN_KEY, ...view.vintages.map((v) => v.key)];
  const values = rows.flatMap((row) => keys.map((key) => row[key]).filter((v) => v != null));
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return niceAxis(lo, hi + (hi - lo) * headroom, { zero: view.unit === "pct" });
}

/**
 * The labelled points with where their text goes: each on its own side
 * (start under the line, latest and end over it) unless a label already
 * there would overlap it, or its text would cover another labelled dot;
 * then on the other side if that is clear, or lifted (`lift` pixels) clear
 * of it. `px` and `py` place a point in the plot (pixels from its left and
 * top); without them every label keeps its own side.
 */
export function pointLabels(points, { px, py, format, narrow = false }) {
  const size = narrow ? "narrow" : "wide";
  const dots = px && py ? points.map((p) => ({ role: p.role, x: px(p.x), y: py(p.y) })) : [];
  const placed = [];
  return points.map((point) => {
    const style = POINT_LABEL[point.role];
    const value = format(point.y);
    const width = Math.max(value.length * VALUE_CHAR[size], style.caption.length * CAPTION_CHAR) + LABEL_GAP;
    const x = px ? px(point.x) : null;
    const span = x == null ? null : style.anchor === "end" ? [x - width, x] : [x - width / 2, x + width / 2];
    const y = py ? py(point.y) : null;
    // The label's text, from 6px off its dot to its reach
    const box = (above, level) => {
      const reach = LABEL_REACH[size] + level * LABEL_LIFT;
      return above ? [y - reach, y - 6] : [y + 6, y + reach];
    };
    const coversDot = (above, level) => {
      if (y == null) return false;
      const [top, bottom] = box(above, level);
      return dots.some((d) => d.role !== point.role && d.x > span[0] && d.x < span[1] && d.y > top && d.y < bottom);
    };
    const labelsClear = (above, level) =>
      !span || !placed.some((l) => l.above === above && l.level === level && l.span[0] < span[1] && span[0] < l.span[1]);
    const clear = (above, level) => labelsClear(above, level) && !coversDot(above, level);
    let above = style.above;
    if (!clear(above, 0) && clear(!above, 0)) above = !above;
    // Lifted past the labels only (a lift never uncovers a dot), so this
    // ends above the highest label placed
    let level = 0;
    while (!labelsClear(above, level)) level += 1;
    const label = { ...point, ...style, above, level, lift: level * LABEL_LIFT, value, span };
    placed.push(label);
    return label;
  });
}

/**
 * A labelled point's text: a short leader line from the dot, the value in
 * large type and what it is ("start", "latest", "end") under it. Recharts
 * passes the dot's box as viewBox.
 */
function PointLabel({ viewBox, value, caption, above, anchor, lift = 0, narrow }) {
  if (!viewBox) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2;
  const sign = above ? -1 : 1;
  const lineEnd = cy + sign * ((narrow ? 14 : 20) + lift);
  const valueSize = narrow ? 13 : 15;
  // The value nearest the line, its caption beyond it
  const valueY = above ? lineEnd - 20 : lineEnd + valueSize + 2;
  const captionY = valueY + 14;
  // A halo in the card's colour keeps the text clear of the lines under it
  const halo = { stroke: CHART_COLOURS.surface, strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" };
  return (
    <g className="fv-point-label">
      <line x1={cx} y1={cy + sign * 6} x2={cx} y2={lineEnd} stroke={CHART_COLOURS.text} strokeWidth={1} />
      <text x={cx} y={valueY} textAnchor={anchor} fontSize={valueSize} fontWeight={700} fill={CHART_COLOURS.ink} {...halo}>
        {value}
      </text>
      <text x={cx} y={captionY} textAnchor={anchor} fontSize={11} fill={CHART_COLOURS.axisTitle} {...halo}>
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
  const [canvasRef, canvasWidth] = useElementWidth();
  const [lo, hi] = range;
  const shownRows = view.rows.slice(lo, hi + 1);
  const first = shownRows[0]?.x;
  const last = shownRows[shownRows.length - 1]?.x;
  const yWidthFor = (axis) => axisWidth(axis.ticks, (v) => view.format(v, stepDecimals(axis.step)), { title: false }) + 12;
  const widthFor = (axis) => canvasWidth - yWidthFor(axis) - MARGIN.left - MARGIN.right;
  // The labels are laid out on the axis without headroom; a lifted one
  // needs headroom, which leaves the tick labels (and so the plot's width)
  // all but the same
  const fitted = yAxisFor(view, shownRows) ?? niceAxis(0, 1);
  const span = widthFor(fitted);
  const px = span > 0 && last > first ? (x) => ((x - first) / (last - first)) * span : null;
  const [bottom, top] = fitted.domain;
  const py = (y) => ((top - y) / (top - bottom)) * PLOT_HEIGHT[narrow ? "narrow" : "wide"];
  const points = view.points.filter((p) => p.x >= first && p.x <= last);
  const labels = pointLabels(points, { px, py, format: view.format, narrow });
  const lifted = labels.some((l) => l.above && l.lift > 0);
  const axis = lifted ? yAxisFor(view, shownRows, { headroom: LIFT_HEADROOM }) : fitted;
  const decimals = stepDecimals(axis.step);
  const tickFormat = (v) => view.format(v, decimals);
  const yWidth = yWidthFor(axis);
  const plotWidth = widthFor(axis);
  const brushWidth = plotWidth > 3 * BRUSH_END_LABEL ? plotWidth - BRUSH_END_LABEL : undefined;
  const ticks = xTicks(shownRows, view.frequency);
  // Quarterly ticks name the year only: each sits at its first quarter
  const tickLabel = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
  const past = view.vintages.filter((v) => !v.newest);
  const newest = view.vintages.find((v) => v.newest);

  return (
    <>
      <div className="chart-plot ls-plot-fill fv-plot" style={{ minHeight: CHART_HEIGHT[narrow ? "narrow" : "wide"] }}>
        <div className="ls-plot-canvas" ref={canvasRef}>
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
              {labels.map((l) => (
                <ReferenceDot
                  key={l.role}
                  x={l.x}
                  y={l.y}
                  r={4.5}
                  fill={l.role === "end" ? LINE_STYLE.newest.colour : LINE_STYLE.outturn.colour}
                  stroke={CHART_COLOURS.surface}
                  strokeWidth={1.5}
                  ifOverflow="discard"
                  label={
                    <PointLabel
                      value={l.value}
                      caption={l.caption}
                      above={l.above}
                      anchor={l.anchor}
                      lift={l.lift}
                      narrow={narrow}
                    />
                  }
                />
              ))}
              <Brush
                dataKey="x"
                height={BRUSH_HEIGHT}
                width={brushWidth}
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

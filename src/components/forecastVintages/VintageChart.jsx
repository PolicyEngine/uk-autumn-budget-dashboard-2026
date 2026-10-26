// The OBR forecasts chart: the ONS outturn as a solid line, each earlier
// OBR forecast as a thin dashed line from where it was made, the newest
// forecast as a bold dashed line, the start, latest and end points
// labelled, and a brush under the x axis to choose the periods shown.
// Draws a view from utils/forecastVintages/view.js; the card around it is
// ForecastVintagesView's.

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
import { OUTTURN_KEY, niceAxis, pointsIn, stepDecimals } from "../../utils/forecastVintages/view";

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
// A label lifted clear of the others moves out this far a level, at most
// this many levels (any three labels are clear well before then)
const LABEL_LIFT = 34;
const MAX_LEVEL = 40;
// The caption's size, and the space kept between two labels' text
const CAPTION_SIZE = 11;
const LABEL_GAP = { x: 6, y: 2 };
// The unit label over the y axis (ChartUnitLabel): 12px, its baseline 12px
// above the plot
const UNIT_SIZE = 12;
const UNIT_BASELINE = -12;
// A labelled dot's radius, its outline included
const DOT_REACH = 6;
// A label that would leave the plot gets room made for it above or below
// the data, this share of the range at a time, at most this many times
const ROOM_STEP = 0.3;
const ROOM_ROUNDS = 3;

// Room above the plot for the unit label and the labelled points' values,
// and to its right for half the last year's label ("2030-31", 49px)
export const MARGIN = { top: 56, right: 28, left: 0, bottom: 0 };
const X_AXIS_HEIGHT = 30;
const BRUSH_HEIGHT = 26;
// The chart's height, and the plot's within it (less the margin, the x
// axis and the brush)
const CHART_HEIGHT = { wide: 440, narrow: 340 };
const PLOT_HEIGHT = {
  wide: CHART_HEIGHT.wide - MARGIN.top - X_AXIS_HEIGHT - BRUSH_HEIGHT,
  narrow: CHART_HEIGHT.narrow - MARGIN.top - X_AXIS_HEIGHT - BRUSH_HEIGHT,
};
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
    items.push({
      label: "Earlier forecasts",
      color: LINE_STYLE.past.colour,
      type: "line",
      dash: LINE_STYLE.past.dash,
    });
  }
  return items;
}

const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];
// Tried only where none of those puts two years on a narrow plot
const ODD_STEPS = [4, 3, 40, 30];
// Clear space between two year labels on the x axis, over the room to
// spare in textWidth
const TICK_GAP = 4;

/**
 * X-axis ticks at the start of whole years, at most eight across the rows,
 * every so many years (the first of YEAR_STEPS that gives two or more).
 * Once the plot is measured (`plotWidth` pixels), the years are far enough
 * apart for their labels (`label` gives a tick's text) to sit TICK_GAP
 * apart, and a label that would pass the plot's left edge by more than
 * `edge.left` or its right by more than `edge.right` is left off.
 */
export function xTicks(rows, frequency, { plotWidth = 0, label = String, edge = { left: Infinity, right: Infinity } } = {}) {
  if (!rows.length) return [];
  const perYear = frequency === "quarterly" ? 4 : 1;
  const x0 = rows[0].x;
  const x1 = rows[rows.length - 1].x;
  const first = Math.ceil(x0 / perYear);
  const last = Math.floor(x1 / perYear);
  const years = last - first + 1;
  const measured = plotWidth > 0 && x1 > x0;
  const px = (x) => ((x - x0) / (x1 - x0)) * plotWidth;
  const width = (x) => textWidth(label(x), TICK_STYLE.fontSize);
  let widest = 0;
  if (measured) for (let y = first; y <= last; y += 1) widest = Math.max(widest, width(y * perYear));
  const fits = (s) => years / s <= 8 && (!measured || s * perYear * (plotWidth / (x1 - x0)) >= widest + TICK_GAP);
  const every = (step) => {
    const ticks = [];
    let clearFrom = -Infinity;
    for (let y = Math.ceil(first / step) * step; y <= last; y += step) {
      const x = y * perYear;
      if (measured) {
        const [left, right] = [px(x) - width(x) / 2, px(x) + width(x) / 2];
        if (left < -edge.left || right > plotWidth + edge.right) continue;
        // Where no step is wide enough (a very narrow plot), a year too
        // close to the last is left off
        if (left < clearFrom) continue;
        clearFrom = right + TICK_GAP;
      }
      ticks.push(x);
    }
    return ticks;
  };
  const steps = [...YEAR_STEPS, ...ODD_STEPS].filter(fits);
  return steps.map(every).find((ticks) => ticks.length >= 2) ?? every(steps[0] ?? YEAR_STEPS[YEAR_STEPS.length - 1]);
}

/**
 * The y axis over the rows shown: round steps, from 0 for a % view, with
 * `headroom` and `footroom` (shares of the range) kept free above and
 * below the data.
 */
export function yAxisFor(view, rows, { headroom = 0, footroom = 0 } = {}) {
  const keys = [OUTTURN_KEY, ...view.vintages.map((v) => v.key)];
  const values = rows.flatMap((row) => keys.map((key) => row[key]).filter((v) => v != null));
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return niceAxis(lo - (hi - lo) * footroom, hi + (hi - lo) * headroom, {
    zero: view.unit === "pct",
  });
}

/**
 * Where a labelled point's text goes, out from its dot (PointLabel draws
 * it from this, and pointLabels lays it out from it): a leader line, then
 * the value with its caption under it, all `lift` pixels further out for
 * a lifted label. In pixels from the dot, down positive.
 */
export function labelGeometry({ above, lift = 0, narrow = false }) {
  const sign = above ? -1 : 1;
  const lineEnd = sign * ((narrow ? 14 : 20) + lift);
  const valueSize = narrow ? 13 : 15;
  const valueY = above ? lineEnd - 20 : lineEnd + valueSize + 2;
  return {
    lineStart: sign * 6,
    lineEnd,
    valueSize,
    valueY,
    captionY: valueY + 14,
  };
}

// A line of text's box: digits and capitals rise about 0.8 of the font
// size above the baseline, and a comma falls about a quarter below it
function textBox(x, baseline, width, size, anchor) {
  const left = anchor === "end" ? x - width : anchor === "start" ? x : x - width / 2;
  return {
    left,
    right: left + width,
    top: baseline - 0.8 * size,
    bottom: baseline + 0.25 * size,
  };
}

/** A label's value, caption and leader line, as boxes in the plot's pixels. */
export function labelBoxes({ x, y, above, lift = 0, anchor, value, caption, narrow = false }) {
  const g = labelGeometry({ above, lift, narrow });
  return {
    text: [
      textBox(x, y + g.valueY, textWidth(value, g.valueSize, true), g.valueSize, anchor),
      textBox(x, y + g.captionY, textWidth(caption, CAPTION_SIZE), CAPTION_SIZE, anchor),
    ],
    line: {
      left: x - 0.5,
      right: x + 0.5,
      top: y + Math.min(g.lineStart, g.lineEnd),
      bottom: y + Math.max(g.lineStart, g.lineEnd),
    },
  };
}

// Inter's advance widths, in ems, measured in the page: bold for the
// values, regular (or medium, whichever is wider) for the captions and
// the unit label. A character not listed takes the widest of its kind.
const BOLD_EM = {
  0: 0.68, 1: 0.44, 2: 0.63, 3: 0.65, 4: 0.68, 5: 0.63, 6: 0.65, 7: 0.6, 8: 0.66, 9: 0.65,
  "£": 0.64, "%": 1.02, ",": 0.34, ".": 0.34, "-": 0.47, b: 0.63, n: 0.63, m: 0.92,
};
const REGULAR_EM = {
  0: 0.65, 1: 0.42, 2: 0.62, 3: 0.63, 4: 0.66, 5: 0.61, 6: 0.63, 7: 0.59, 8: 0.63, 9: 0.63,
  "£": 0.62, "%": 1.0, ",": 0.31, ".": 0.31, "-": 0.47, " ": 0.28, "(": 0.37, ")": 0.37, "=": 0.67,
  a: 0.57, b: 0.62, c: 0.58, d: 0.62, e: 0.59, g: 0.62, h: 0.61, i: 0.26, l: 0.26, m: 0.89,
  n: 0.61, o: 0.61, p: 0.62, r: 0.4, s: 0.54, t: 0.34, u: 0.61, v: 0.58, x: 0.56, y: 0.58,
  D: 0.73, G: 0.75, I: 0.28, P: 0.65,
};
// Room to spare where the page falls back to another font
const WIDTH_SPARE = 1.06;

/** A line of text's width in pixels, from Inter's glyph widths. */
export function textWidth(text, size, bold = false) {
  const table = bold ? BOLD_EM : REGULAR_EM;
  let em = 0;
  for (const ch of String(text)) em += table[ch] ?? (bold ? 1.02 : 1.0);
  return em * size * WIDTH_SPARE;
}

/** Whether two boxes overlap, or come within `gap` of each other. */
export function boxesMeet(a, b, gap = { x: 0, y: 0 }) {
  return a.left < b.right + gap.x && b.left < a.right + gap.x && a.top < b.bottom + gap.y && b.top < a.bottom + gap.y;
}

const inside = (box, bounds) =>
  box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;

/**
 * The labelled points with where their text goes. Each label is tried on
 * its own side (start under the line, latest and end over it), then on
 * the other, then lifted a level at a time on either; at each, with its
 * own anchor, then starting or ending at its leader line. It goes where
 * its text is clear of the labels already placed and of `obstacles`, with
 * the fewest of these: its text or leader line on another labelled dot,
 * its line across another label's text or its text across another's line,
 * its text outside `bounds` (which the chart then makes room for). Text
 * never overlaps text; the rest are kept off where any place avoids them.
 * Text anchored at its middle that would cross a side of `bounds` is
 * anchored at that side instead. `px` and `py` place a point in the plot
 * (pixels from its left and top); without them every label keeps its own
 * side, unlifted.
 */
export function pointLabels(points, { px, py, format, narrow = false, bounds = null, obstacles = [] }) {
  const laidOut = Boolean(px && py);
  const dots = laidOut
    ? points.map((p) => {
        const x = px(p.x);
        const y = py(p.y);
        return {
          role: p.role,
          box: {
            left: x - DOT_REACH,
            right: x + DOT_REACH,
            top: y - DOT_REACH,
            bottom: y + DOT_REACH,
          },
        };
      })
    : [];
  const placed = [];
  return points.map((point) => {
    const style = POINT_LABEL[point.role];
    const value = format(point.y);
    if (!laidOut) return { ...point, ...style, value, level: 0, lift: 0, boxes: null };
    const x = px(point.x);
    const y = py(point.y);
    const width = Math.max(
      textWidth(value, labelGeometry({ above: true, narrow }).valueSize, true),
      textWidth(style.caption, CAPTION_SIZE),
    );
    let anchor = style.anchor;
    if (bounds) {
      const left = anchor === "end" ? x - width : x - width / 2;
      if (left < bounds.left) anchor = "start";
      else if (anchor === "middle" && x + width / 2 > bounds.right) anchor = "end";
    }
    // Starting or ending at its line instead, where that keeps it inside
    const across = (a) => (a === "end" ? [x - width, x] : a === "start" ? [x, x + width] : [x - width / 2, x + width / 2]);
    const fitsAcross = (a) => !bounds || (across(a)[0] >= bounds.left && across(a)[1] <= bounds.right);
    const anchors = [anchor, ...["start", "end"].filter((a) => a !== anchor && fitsAcross(a))];
    const at = (above, level, textAnchor = anchor) =>
      labelBoxes({
        x,
        y,
        above,
        lift: level * LABEL_LIFT,
        anchor: textAnchor,
        value,
        caption: style.caption,
        narrow,
      });
    const textClear = (boxes) =>
      boxes.text.every(
        (t) =>
          !placed.some((l) => l.boxes.text.some((u) => boxesMeet(t, u, LABEL_GAP))) &&
          !obstacles.some((o) => boxesMeet(t, o, LABEL_GAP)),
      );
    const conflicts = (boxes) => {
      const own = [...boxes.text, boxes.line];
      const onDots = dots.filter((d) => d.role !== point.role && own.some((b) => boxesMeet(b, d.box))).length;
      const crossings = placed.filter(
        (l) => l.boxes.text.some((u) => boxesMeet(boxes.line, u)) || boxes.text.some((t) => boxesMeet(t, l.boxes.line)),
      ).length;
      const outside = bounds && !boxes.text.every((t) => inside(t, bounds)) ? 1 : 0;
      return onDots + crossings + outside;
    };
    let best = null;
    search: for (let level = 0; level <= MAX_LEVEL; level += 1) {
      for (const above of [style.above, !style.above]) {
        for (const textAnchor of anchors) {
          const boxes = at(above, level, textAnchor);
          if (!textClear(boxes)) continue;
          const count = conflicts(boxes);
          if (!best || count < best.conflicts) best = { above, level, anchor: textAnchor, boxes, conflicts: count };
          if (count === 0) break search;
        }
      }
    }
    // Lifted past every other label's text, which always ends the search
    // well before MAX_LEVEL; this keeps it finite for any input
    best ??= {
      above: style.above,
      level: MAX_LEVEL,
      anchor,
      boxes: at(style.above, MAX_LEVEL),
    };
    const label = {
      ...point,
      ...style,
      anchor: best.anchor,
      above: best.above,
      level: best.level,
      lift: best.level * LABEL_LIFT,
      value,
      boxes: best.boxes,
      // How many of the conflicts above it could not avoid (0 nearly always)
      conflicts: best.conflicts ?? null,
    };
    placed.push(label);
    return label;
  });
}

/** Whether any label's text leaves `bounds` above or below. */
export function labelOverflow(labels, bounds) {
  const text = labels.flatMap((l) => (l.boxes ? l.boxes.text : []));
  return {
    top: text.some((b) => b.top < bounds.top),
    bottom: text.some((b) => b.bottom > bounds.bottom),
  };
}

const yWidthFor = (view, axis) =>
  axisWidth(axis.ticks, (v) => view.format(v, stepDecimals(axis.step)), {
    title: false,
  }) + 12;

/**
 * The y axis and the labelled points' places over the rows shown, for a
 * canvas `canvasWidth` pixels wide: the labels are laid out on the axis
 * that is drawn. Where a label would leave the plot (past the top margin,
 * under the plot's foot), room is made above or below the data and the
 * labels laid out again; where a label has a conflict it could not avoid
 * (its text on another dot, say), room above or below is tried, and kept
 * if it leaves fewer. At most ROOM_ROUNDS rounds either way.
 */
export function chartLayout(view, rows, { canvasWidth, narrow = false }) {
  const plotHeight = PLOT_HEIGHT[narrow ? "narrow" : "wide"];
  const first = rows[0]?.x;
  const last = rows[rows.length - 1]?.x;
  const points = pointsIn(view.points, rows);
  const layoutOn = (room) => {
    const axis = yAxisFor(view, rows, room) ?? niceAxis(0, 1);
    const yWidth = yWidthFor(view, axis);
    const plotWidth = canvasWidth - yWidth - MARGIN.left - MARGIN.right;
    const px = plotWidth > 0 && last > first ? (x) => ((x - first) / (last - first)) * plotWidth : null;
    const [bottom, top] = axis.domain;
    const py = (y) => ((top - y) / (top - bottom)) * plotHeight;
    const bounds = {
      left: 0,
      right: plotWidth + MARGIN.right - 2,
      top: 2 - MARGIN.top,
      bottom: plotHeight,
    };
    const unitLabel = {
      left: -yWidth,
      right: -yWidth + textWidth(view.axisLabel, UNIT_SIZE),
      top: UNIT_BASELINE - 0.8 * UNIT_SIZE,
      bottom: UNIT_BASELINE + 3,
    };
    const labels = pointLabels(points, {
      px,
      py,
      format: view.format,
      narrow,
      bounds,
      obstacles: [unitLabel],
    });
    return {
      axis,
      yWidth,
      plotWidth,
      plotHeight,
      bounds,
      labels,
      overflow: labelOverflow(labels, bounds),
      room,
    };
  };
  const unavoided = (layout) => layout.labels.reduce((n, l) => n + (l.conflicts ?? 0), 0);
  const fits = (layout) => !layout.overflow.top && !layout.overflow.bottom;
  let layout = layoutOn({ headroom: 0, footroom: 0 });
  for (let round = 0; round < ROOM_ROUNDS; round += 1) {
    const { headroom, footroom } = layout.room;
    if (!fits(layout)) {
      layout = layoutOn({
        headroom: headroom + (layout.overflow.top ? ROOM_STEP : 0),
        footroom: footroom + (layout.overflow.bottom ? ROOM_STEP : 0),
      });
      continue;
    }
    if (!unavoided(layout)) break;
    const better = [
      layoutOn({ headroom: headroom + ROOM_STEP, footroom }),
      layoutOn({ headroom, footroom: footroom + ROOM_STEP }),
    ]
      .filter((l) => fits(l) && unavoided(l) < unavoided(layout))
      .sort((a, b) => unavoided(a) - unavoided(b))[0];
    if (!better) break;
    layout = better;
  }
  return layout;
}

/**
 * A labelled point's leader line from the dot (`part` "line"), or its
 * value in large type and what it is ("start", "latest", "end") under it
 * (`part` "text"). Every line is drawn before any text, so where a leader
 * line has to pass another label, it passes under that label's text.
 * Recharts passes the dot's box as viewBox.
 */
function PointLabel({ viewBox, part, role, value, caption, above, anchor, lift = 0, narrow }) {
  if (!viewBox) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2;
  const g = labelGeometry({ above, lift, narrow });
  if (part === "line") {
    return (
      <line
        className="fv-point-line"
        data-role={role}
        x1={cx}
        y1={cy + g.lineStart}
        x2={cx}
        y2={cy + g.lineEnd}
        stroke={CHART_COLOURS.text}
        strokeWidth={1}
      />
    );
  }
  // A halo in the card's colour keeps the text clear of the lines under it
  const halo = {
    stroke: CHART_COLOURS.surface,
    strokeWidth: 3,
    strokeLinejoin: "round",
    paintOrder: "stroke",
  };
  return (
    <g className="fv-point-label" data-role={role}>
      <text
        x={cx}
        y={cy + g.valueY}
        textAnchor={anchor}
        fontSize={g.valueSize}
        fontWeight={700}
        fill={CHART_COLOURS.ink}
        {...halo}
      >
        {value}
      </text>
      <text
        x={cx}
        y={cy + g.captionY}
        textAnchor={anchor}
        fontSize={CAPTION_SIZE}
        fill={CHART_COLOURS.axisTitle}
        {...halo}
      >
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
  const { axis, yWidth, plotWidth, labels } = chartLayout(view, shownRows, {
    canvasWidth,
    narrow,
  });
  const decimals = stepDecimals(axis.step);
  const tickFormat = (v) => view.format(v, decimals);
  const brushWidth = plotWidth > 3 * BRUSH_END_LABEL ? plotWidth - BRUSH_END_LABEL : undefined;
  // Quarterly ticks name the year only: each sits at its first quarter
  const tickLabel = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
  const ticks = xTicks(shownRows, view.frequency, {
    plotWidth,
    label: tickLabel,
    edge: { left: yWidth, right: MARGIN.right },
  });
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
                height={X_AXIS_HEIGHT}
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
              {/* The dots and their leader lines, then (with no dot) the text */}
              {["line", "text"].flatMap((part) =>
                labels.map((l) => (
                  <ReferenceDot
                    key={`${part}-${l.role}`}
                    x={l.x}
                    y={l.y}
                    r={4.5}
                    fill={l.role === "end" ? LINE_STYLE.newest.colour : LINE_STYLE.outturn.colour}
                    stroke={CHART_COLOURS.surface}
                    strokeWidth={1.5}
                    ifOverflow="discard"
                    shape={part === "text" ? () => <g /> : undefined}
                    label={
                      <PointLabel
                        part={part}
                        role={l.role}
                        value={l.value}
                        caption={l.caption}
                        above={l.above}
                        anchor={l.anchor}
                        lift={l.lift}
                        narrow={narrow}
                      />
                    }
                  />
                )),
              )}
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

// A level over time (Incomes over time, Inequality over time, Poverty over
// time): official figures as a solid grey line with dots, PolicyEngine's
// microsimulation solid teal (not dashed: it is not a forecast), each named
// above its start on the plot (no key), clear of the other line. No band
// marks the PolicyEngine years: they are not a forecast, and they overlap
// the official ones. The y axis is fitted to the data
// (zoomAxis), with a break mark when it does not start at 0. No values are
// printed on the plot (the card's sentence states the years it compares,
// the tooltip gives each value exactly). Ticks every year on a wide plot,
// every other year on a phone.

import { CartesianGrid, Customized, Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { ChartRows, lineLegendItems } from "./LsCharts";
import ChartUnitLabel, { UNIT_LABEL_TOP_MARGIN } from "../../utils/ChartUnitLabel";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import useElementWidth from "../../hooks/useElementWidth";
import { AXIS_LINE, CHART_COLOURS, GRID_PROPS, TICK_STYLE, axisWidth, useNarrowViewport } from "../../utils/chartTheme";
import { zoomAxis } from "../../utils/livingStandards/baseline";
import { fyLabel } from "../../utils/livingStandards/outlook";

const MARGIN = { top: UNIT_LABEL_TOP_MARGIN, right: 24, left: 0, bottom: 0 };
const X_AXIS_HEIGHT = 26;
// Width a "2027-28" tick needs before every other year is labelled
const TICK_WIDTH = 58;
const LABEL = { fontSize: 12, fontWeight: 600 };
// Width of a label: measured in the page's font where there is a canvas,
// else estimated per character (12px semibold, or 11px regular)
let measurer;
function textWidth(text, size = 12, weight = 600) {
  if (typeof document !== "undefined") {
    try {
      measurer ??= document.createElement("canvas").getContext("2d");
    } catch {
      measurer = null;
    }
    if (measurer) {
      measurer.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
      const w = measurer.measureText(String(text)).width;
      if (w > 0) return w;
    }
  }
  return String(text).length * size * (weight >= 600 ? 0.53 : 0.5);
}
// Box of a label from its baseline (cap height above, descenders below)
const textBox = (left, baseline, w) => ({ left, right: left + w, top: baseline - 10, bottom: baseline + 3 });
const GAP = 4;
const DOT = 4;

/** Whether a box is clear of the lines (polylines of [x, y]), their dots and other boxes. */
function isClear(box, lines, boxes) {
  const L = box.left - GAP;
  const R = box.right + GAP;
  const T = box.top - GAP;
  const B = box.bottom + GAP;
  for (const pts of lines) {
    for (const [px, py] of pts) {
      if (px + DOT > L && px - DOT < R && py + DOT > T && py - DOT < B) return false;
    }
    for (let k = 1; k < pts.length; k += 1) {
      const [x1, y1] = pts[k - 1];
      const [x2, y2] = pts[k];
      const lo = Math.max(L, x1);
      const hi = Math.min(R, x2);
      if (lo > hi) continue;
      const at = (xx) => (x2 === x1 ? y1 : y1 + ((y2 - y1) * (xx - x1)) / (x2 - x1));
      if (Math.min(at(lo), at(hi)) < B && Math.max(at(lo), at(hi)) > T) return false;
    }
  }
  // Text from text: half the gap (the boxes already pad the glyphs)
  const g = GAP / 2;
  return boxes.every((b) => b.right + g <= box.left || b.left - g >= box.right || b.bottom + g <= box.top || b.top - g >= box.bottom);
}

/** The y of a polyline at each of its points within [x0, x1], and where it crosses x0 and x1. */
function ysWithin(pts, x0, x1) {
  const ys = pts.filter(([px]) => px >= x0 && px <= x1).map(([, py]) => py);
  for (let k = 1; k < pts.length; k += 1) {
    const [xa, ya] = pts[k - 1];
    const [xb, yb] = pts[k];
    [x0, x1].forEach((xx) => {
      if (xx > xa && xx < xb) ys.push(ya + ((yb - ya) * (xx - xa)) / (xb - xa));
    });
  }
  return ys;
}

/**
 * Baseline for a label starting at x0 over its own line: 12px above the
 * line's highest point under the label, nudged up until clear of the lines,
 * dots and boxes, but not past another line above its start (it would read
 * as that line's name); else just below its own line; else nudged up past the other
 * line; else where it would first go.
 */
export function placeLabel({ own, x0, w, lines, boxes, top, bottom }) {
  const ownYs = ysWithin(own, x0, x0 + w);
  const ys = ownYs.length ? ownYs : [own[0][1]];
  const preferred = Math.min(...ys) - 12;
  // Another line above this one where the label starts: the label stays
  // under it, so it is not read as that line's name
  const above = lines
    .filter((pts) => pts !== own)
    .flatMap((pts) => ysWithin(pts, x0, x0))
    .filter((v) => v < own[0][1]);
  const ceiling = above.length ? Math.max(...above) : -Infinity;
  const clear = (bl) => isClear(textBox(x0, bl, w), lines, boxes);
  for (let bl = preferred; bl - 10 >= top && bl - 10 > ceiling; bl -= 2) {
    if (clear(bl)) return bl;
  }
  for (let bl = Math.max(...ys) + 12; bl + 3 <= bottom; bl += 1) {
    if (clear(bl)) return bl;
  }
  for (let bl = preferred; bl - 10 >= top; bl -= 2) {
    if (clear(bl)) return bl;
  }
  return preferred;
}

/** "2029-30, PolicyEngine: £42,900", one line per series at the year. */
function OverTimeTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="chart-tooltip">
      {rows.map((p) => (
        <p key={p.dataKey} className="chart-tooltip-row">
          <span className="chart-tooltip-swatch chart-tooltip-swatch-line" style={{ background: p.color }} />
          <span>
            {fyLabel(label)}, {p.name}
          </span>
          <span className="chart-tooltip-value">{format(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** The plot's annotations, in its SVG (so the downloads carry them). */
function Annotations({ xAxisMap, yAxisMap, offset, data, showHistorical, showProjection, broken }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale || !offset) return null;
  const x = (year) => xAxis.scale(year) + (xAxis.scale.bandwidth?.() ?? 0) / 2;
  const y = (v) => yAxis.scale(v);
  const bottom = offset.top + offset.height;
  // The break sits on the x axis just right of the y axis's labels
  const left = offset.left + 4;
  const parts = [];

  // The axis does not start at 0: a break on the x axis's left end
  if (broken) {
    parts.push(
      <g key="break" className="ls-axis-break">
        <rect x={left - 5} y={bottom - 5} width={10} height={10} fill={CHART_COLOURS.surface} />
        <path d={`M${left - 6},${bottom + 3} L${left - 1},${bottom - 4} M${left + 1},${bottom + 3} L${left + 6},${bottom - 4}`} stroke={CHART_COLOURS.axisTitle} strokeWidth={1.2} fill="none" />
      </g>,
    );
  }

  // Each line named above its start: "Official figures" grey, "PolicyEngine"
  // teal, clear of both lines, their dots and each other
  const lines = [
    showHistorical && { key: "historical", text: "Official figures", fill: CHART_COLOURS.obrText },
    showProjection && { key: "projection", text: "PolicyEngine", fill: CHART_COLOURS.highlight },
  ].filter(Boolean);
  const points = lines.map(({ key }) => data.filter((d) => d[key] != null).map((d) => [x(d.year), y(d[key])]));
  const placed = [];
  lines.forEach(({ key, text, fill }, i) => {
    const own = points[i];
    if (!own.length) return;
    const x0 = own[0][0];
    const w = textWidth(text);
    const baseline = placeLabel({ own, x0, w, lines: points, boxes: placed, top: offset.top - 4, bottom: bottom - 2 });
    placed.push(textBox(x0, baseline, w));
    parts.push(
      <text key={key} x={x0} y={baseline} {...LABEL} fill={fill} textAnchor="start">
        {text}
      </text>,
    );
  });

  return <g>{parts}</g>;
}

/**
 * series: lineSeries(viewMode, hasOutturn) (keys historical, projection).
 */
export default function OverTimeChart({
  data,
  series,
  yFormat,
  tooltipFormat,
  yLabel,
  // The years the card's sentence compares, [from, to], shaded so the
  // Years choice shows on the plot (Pavel's review, LS6)
  span = null,
}) {
  const narrow = useNarrowViewport();
  const [ref, width] = useElementWidth();
  const show = Object.fromEntries(series.map((s) => [s.key, !s.hidden]));
  const values = data.flatMap((d) => [show.historical ? d.historical : null, show.projection ? d.projection : null]);
  const axis = zoomAxis(values);
  const yWidth = axisWidth(axis.ticks, yFormat, { title: false }) + 12;
  const years = data.map((d) => d.year);
  const plotWidth = width ? width - yWidth - MARGIN.right : 0;
  // Every year where they fit, else every other year back from the last
  const every = !narrow && (!plotWidth || plotWidth / years.length >= TICK_WIDTH);
  const ticks = every ? years : years.filter((_, i) => (years.length - 1 - i) % 2 === 0);
  const visible = series.filter((s) => !s.hidden);

  return (
    <ChartRows plotRef={ref} legendItems={lineLegendItems(visible)} height={narrow ? 230 : 320} legend={false}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid {...GRID_PROPS} />
          {span && years.includes(span[0]) && years.includes(span[1]) && (
            <ReferenceArea
              className="over-time-span"
              x1={span[0]}
              x2={span[1]}
              fill={CHART_COLOURS.highlightBand}
              fillOpacity={0.7}
              ifOverflow="hidden"
            />
          )}
          <XAxis
            dataKey="year"
            tick={TICK_STYLE}
            axisLine={AXIS_LINE}
            tickLine={false}
            height={X_AXIS_HEIGHT}
            padding={{ left: 12, right: 8 }}
            tickMargin={6}
            ticks={ticks}
            interval={0}
            // On a phone "21-22", as the distribution chart's ticks
            tickFormatter={narrow ? (y) => fyLabel(y).slice(2) : fyLabel}
          />
          <YAxis
            domain={axis.domain}
            ticks={axis.ticks}
            tickFormatter={yFormat}
            tick={TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={yWidth}
            allowDecimals
          />
          <Tooltip {...TOOLTIP_PROPS} cursor={{ stroke: CHART_COLOURS.axis }} content={<OverTimeTooltip format={tooltipFormat} />} />
          {visible.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.colour}
              strokeWidth={2.5}
              dot={{ r: 3, fill: s.colour, stroke: s.colour, strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <Customized component={<ChartUnitLabel text={yLabel} horizontal />} />
          <Customized
            component={
              <Annotations
                data={data}
                showHistorical={show.historical}
                showProjection={show.projection}
                broken={axis.broken}
              />
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartRows>
  );
}

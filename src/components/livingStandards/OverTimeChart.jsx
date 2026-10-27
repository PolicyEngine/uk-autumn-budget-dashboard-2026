// A level over time (Incomes over time, Inequality over time, Poverty over
// time): official figures as a solid grey line with dots, PolicyEngine's
// microsimulation dashed teal, both named on the plot (no key). No band
// marks the PolicyEngine years: they are not a forecast, and they overlap
// the official ones. The y axis is fitted to the data
// (zoomAxis), with a break mark when it does not start at 0. The years the
// card's sentence compares are bracketed under the lines, with the
// PolicyEngine value labelled at both ends. Ticks every year on a wide
// plot, every other year on a phone.

import { CartesianGrid, Customized, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { ChartRows, lineLegendItems } from "./LsCharts";
import ChartUnitLabel, { UNIT_LABEL_TOP_MARGIN } from "../../utils/ChartUnitLabel";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import useElementWidth from "../../hooks/useElementWidth";
import { AXIS_LINE, CHART_COLOURS, GRID_PROPS, TICK_STYLE, axisWidth, useNarrowViewport } from "../../utils/chartTheme";
import { zoomAxis } from "../../utils/livingStandards/baseline";
import { fyLabel, fyStart } from "../../utils/livingStandards/outlook";

const MARGIN = { top: UNIT_LABEL_TOP_MARGIN, right: 24, left: 0, bottom: 0 };
const X_AXIS_HEIGHT = 26;
// Width a "2027-28" tick needs before every other year is labelled
const TICK_WIDTH = 58;
const LABEL = { fontSize: 12, fontWeight: 600 };

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
function Annotations({ xAxisMap, yAxisMap, offset, data, showHistorical, showProjection, compare, valueFormat, broken }) {
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

  // "Official figures" above the whole official line, from its first year
  const official = showHistorical ? data.filter((d) => d.historical != null) : [];
  if (official.length) {
    const top = Math.min(...official.map((d) => y(d.historical)));
    parts.push(
      <text key="official" x={x(official[0].year)} y={top - 12} {...LABEL} fill={CHART_COLOURS.obrText} textAnchor="start">
        Official figures
      </text>,
    );
  }

  // "PolicyEngine" under the end of its line; where the line ends too close
  // to the years-compared bracket, above it (over the end value, if any)
  const model = showProjection ? data.filter((d) => d.projection != null) : [];
  if (model.length) {
    const end = model[model.length - 1];
    const below = y(end.projection) + 20;
    const endValued = compare && fyStart(compare[1]) === end.year;
    const labelY = below <= bottom - 32 ? below : y(end.projection) - (endValued ? 28 : 12);
    parts.push(
      <text key="model" x={x(end.year)} y={labelY} {...LABEL} fill={CHART_COLOURS.highlight} textAnchor="end">
        PolicyEngine
      </text>,
    );
  }

  // The years compared: a bracket under the lines, the PolicyEngine value
  // labelled at both ends
  if (compare && showProjection) {
    const [a, b] = compare.map((fy) => data.find((d) => d.year === fyStart(fy)));
    if (a && b && a.projection != null && b.projection != null) {
      const x1 = x(a.year);
      const x2 = x(b.year);
      const yb = bottom - 12;
      parts.push(
        <g key="compare" className="ls-compare">
          <path d={`M${x1},${yb - 5} L${x1},${yb} L${x2},${yb} L${x2},${yb - 5}`} stroke={CHART_COLOURS.highlight} strokeWidth={1.2} fill="none" />
          <text x={(x1 + x2) / 2} y={yb - 5} fontSize={11} fill={CHART_COLOURS.highlight} textAnchor="middle">
            Years compared
          </text>
          {[a, b].map((d, i) => (
            <text key={d.year} x={x(d.year)} y={y(d.projection) - 12} {...LABEL} fill={CHART_COLOURS.highlight} textAnchor={i === 1 ? "end" : "middle"}>
              {valueFormat(d.projection)}
            </text>
          ))}
        </g>,
      );
    }
  }
  return <g>{parts}</g>;
}

/**
 * series: lineSeries(viewMode, hasOutturn) (keys historical, projection).
 * compare: the years compared, ["2027-28", "2031-32"], or null.
 */
export default function OverTimeChart({
  data,
  series,
  yFormat,
  tooltipFormat,
  valueFormat = tooltipFormat,
  yLabel,
  compare = null,
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
              strokeDasharray={s.key === "projection" ? "8 4" : undefined}
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
                compare={compare}
                valueFormat={valueFormat}
                broken={axis.broken}
              />
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartRows>
  );
}

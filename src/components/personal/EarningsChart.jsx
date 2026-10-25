import { useMemo, useRef, useState } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import { GRID_PROPS, TICK_STYLE, AXIS_TITLE_STYLE, axisWidth, useNarrowViewport, CHART_COLOURS, sweepAxis, BEFORE_DASH, REFERENCE_DASH } from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort, roundTicks } from "../../utils/exampleHouseholds";
import { netIncomeDrops, sweepPoints } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import TitleIcon from "../TitleIcon";
import ViewSwitch from "../ViewSwitch";
import { CHART_VIEWS } from "./chartViews";

export const BEFORE_COLOUR = CHART_COLOURS.before;
export const AFTER_COLOUR = CHART_COLOURS.gain;
const LOSS_COLOUR = CHART_COLOURS.loss;
const ZERO_LINE = CHART_COLOURS.text;
const YOU_COLOUR = CHART_COLOURS.text;
const DROP_FILL = CHART_COLOURS.mutedFill;

export const LEGEND_ITEMS = [
  { label: "Before the selected policies", color: BEFORE_COLOUR, type: "line", dash: BEFORE_DASH },
  { label: "After the selected policies", color: AFTER_COLOUR, type: "line" },
];
const DROP_ITEM = { label: "Net income falls as salary rises", color: CHART_COLOURS.grid };
const CHANGE_ITEM = { label: "Change in net income", color: AFTER_COLOUR };

// What each view draws: its tooltip name, colour, axis and description
const SERIES = {
  before: {
    name: "Net income before",
    color: BEFORE_COLOUR,
    axis: "Net income (£ a year)",
    description: "net income before the selected policies",
  },
  after: {
    name: "Net income after",
    color: AFTER_COLOUR,
    axis: "Net income (£ a year)",
    description: "net income after the selected policies",
  },
  change: {
    name: "Change in net income",
    color: AFTER_COLOUR,
    axis: "Change (£ a year)",
    description: "the change the selected policies make to net income",
  },
};

/** Ticks for a change: symmetric about zero in a 1/2/5 step. */
function changeTicks(maxAbs) {
  const top = Math.max(maxAbs, 10);
  const raw = top / 2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const max = Math.ceil(top / step) * step;
  const ticks = [];
  for (let t = -max; t <= max + step / 1e6; t += step) ticks.push(Math.round(t));
  return ticks;
}

const linePath = (points, x, y, key) =>
  points.map((p, i) => `${i ? "L" : "M"}${x(p.income).toFixed(2)},${y(p[key]).toFixed(2)}`).join("");

/** An area from zero to the change, on one side of zero only. */
const areaPath = (points, x, y, side) => {
  const clip = (v) => (side > 0 ? Math.max(0, v) : Math.min(0, v));
  const top = points.map((p, i) => `${i ? "L" : "M"}${x(p.income).toFixed(2)},${y(clip(p.change)).toFixed(2)}`);
  const last = points[points.length - 1];
  return `${top.join("")}L${x(last.income).toFixed(2)},${y(0).toFixed(2)}L${x(points[0].income).toFixed(2)},${y(0).toFixed(2)}Z`;
};

/** Linear interpolation of `key` at `income` along the sweep. */
function valueAt(points, income, key) {
  if (!points.length) return null;
  if (income <= points[0].income) return points[0][key];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (income <= b.income) {
      const t = (income - a.income) / (b.income - a.income || 1);
      return a[key] + t * (b[key] - a[key]);
    }
  }
  return points[points.length - 1][key];
}

/**
 * Across earnings: the household's net income as the salary varies, in
 * one of three views chosen above the chart: before the selected policies,
 * after them, or the change. Each view draws one series, and the tooltip
 * gives that series only. A dashed line marks "You". In the After view,
 * where net income falls as salary rises by more than £100 a step, the
 * band is shaded.
 *
 * @param {Object} props
 * @param {Object} props.sweep - normaliseHouseholdImpact's sweep
 * @param {number|null} props.salary - The salary used, in the year
 * @param {string} props.yearLabel - "2029-30"
 */
export default function EarningsChart({ sweep, salary, yearLabel }) {
  const narrow = useNarrowViewport();
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState("change");
  const width = measured > 0 ? measured : narrow ? 358 : 900;
  const title = `Net income across earnings, ${yearLabel}`;
  const series = SERIES[view];

  const points = useMemo(() => sweepPoints(sweep), [sweep]);
  const drops = useMemo(() => (view === "after" ? netIncomeDrops(points) : []), [points, view]);

  const { domain: xDomain, ticks: xTicks } = sweepAxis(sweep.max);
  const xMax = xDomain[1];
  const isChange = view === "change";
  const yTicks = isChange
    ? changeTicks(Math.max(...points.map((p) => Math.abs(p.change))))
    : roundTicks(Math.max(1, ...points.map((p) => p[view])));
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const left = axisWidth(yTicks, formatPoundsShort);
  const right = 20;
  const { topH, gap, bottomH, top1 } = earningsLayout(narrow);
  const plotH = topH + gap + bottomH;
  const height = earningsChartHeight(narrow);
  const plotW = Math.max(width - left - right, 40);

  const x = (v) => left + (v / xMax) * plotW;
  const y = (v) => top1 + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const youX = salary !== null && salary <= xMax ? x(salary) : null;
  const youValue = salary !== null ? valueAt(points, salary, view) : null;

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const income = ((px - left) / plotW) * xMax;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.income - income) < Math.abs(points[best].income - income)) best = i;
    });
    setHover(best);
  };

  const hovered = hover !== null ? points[hover] : null;
  const legendItems = [
    isChange ? CHANGE_ITEM : view === "before" ? LEGEND_ITEMS[0] : LEGEND_ITEMS[1],
    ...(drops.length ? [DROP_ITEM] : []),
  ];

  const download = {
    chartRef,
    name: `net-income-across-earnings-${view}-${yearLabel}`,
    exportOptions: {
      title,
      description: `Your household's net income in ${yearLabel} as your salary varies: ${series.description}.`,
      legendItems: legendItems.map((item) => ({ ...item, type: item.type ?? "rect" })),
      logo: CHART_LOGO,
      svgSelector: "svg.earnings-svg",
      reservedLegendHeight: 0,
    },
    csv: () =>
      buildChartCsv({
        title,
        units: "£ a year",
        source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
        columns: [
          { key: "income", label: "Your salary (£)", decimals: 0 },
          { key: "before", label: "Net income before (£)", decimals: 2 },
          { key: "after", label: "Net income after (£)", decimals: 2 },
          { key: "change", label: "Change (£)", decimals: 2 },
        ],
        rows: points,
      }),
  };

  // The tooltip: the hovered point of the series drawn, nothing else
  const tooltipPayload = hovered
    ? [{ dataKey: view, name: series.name, value: hovered[view], color: series.color }]
    : [];
  const tipLeft = hovered ? x(hovered.income) : 0;
  const tipOnLeft = tipLeft > width * 0.6;

  return (
    <div className="card single-year-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="trend" />
            <span className="title-text">{title}</span>
          </h3>
          <p className="chart-description">
            Your household&apos;s net income as your salary varies, with partner income and everything else held fixed.
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-view-switch">
        <ViewSwitch options={CHART_VIEWS} value={view} onChange={setView} label="Net income view" compact />
      </div>
      <div ref={wrapperRef} className="earnings-plot chart-plot">
        <div ref={chartRef} className="earnings-plot-inner">
          <svg
            className="earnings-svg"
            width={width}
            height={height}
            role="img"
            data-view={view}
            aria-label={`${title}: ${series.description}, for salaries from £0 to ${formatPounds(xMax)}.`}
          >
            {/* Bands where net income falls as salary rises */}
            {drops.map((drop) => (
              <rect
                key={drop.from}
                className="earnings-drop"
                x={x(drop.from)}
                y={top1}
                width={Math.max(x(drop.to) - x(drop.from), 1)}
                height={plotH}
                fill={DROP_FILL}
              />
            ))}

            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={left}
                  x2={left + plotW}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={isChange && tick === 0 ? ZERO_LINE : GRID_PROPS.stroke}
                />
                <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                  {formatPoundsShort(tick)}
                </text>
              </g>
            ))}
            <ChartUnitLabel text={series.axis} yAxisMap={{ 0: { x: 0, y: top1, height: plotH } }} />

            {isChange ? (
              <>
                <path d={areaPath(points, x, y, 1)} fill={AFTER_COLOUR} fillOpacity={0.6} stroke="none" />
                <path d={areaPath(points, x, y, -1)} fill={LOSS_COLOUR} fillOpacity={0.6} stroke="none" />
              </>
            ) : (
              <path
                d={linePath(points, x, y, view)}
                fill="none"
                stroke={series.color}
                strokeWidth={2.5}
                strokeDasharray={view === "before" ? BEFORE_DASH : undefined}
              />
            )}

            {/* X axis */}
            <line x1={left} x2={left + plotW} y1={top1 + plotH} y2={top1 + plotH} stroke={CHART_COLOURS.axis} />
            {xTicks.map((tick) => (
              <text key={`x-${tick}`} x={x(tick)} y={top1 + plotH + 18} textAnchor="middle" {...TICK_STYLE}>
                {formatPoundsShort(tick)}
              </text>
            ))}
            <text
              x={left + plotW / 2}
              y={height - 4}
              textAnchor="middle"
              fill={AXIS_TITLE_STYLE.fill}
              fontSize={AXIS_TITLE_STYLE.fontSize}
              fontWeight={AXIS_TITLE_STYLE.fontWeight}
            >
              {`Your salary in ${yearLabel}`}
            </text>

            {/* You */}
            {youX !== null && (
              <g className="earnings-you">
                <line x1={youX} x2={youX} y1={top1} y2={top1 + plotH} stroke={YOU_COLOUR} strokeWidth={1.25} strokeDasharray={REFERENCE_DASH} />
                {youValue !== null && !isChange && (
                  <circle cx={youX} cy={y(youValue)} r={5} fill={series.color} stroke={CHART_COLOURS.surface} strokeWidth={2} />
                )}
                <text
                  x={youX + (youX > left + plotW - 40 ? -6 : 6)}
                  y={top1 + 12}
                  textAnchor={youX > left + plotW - 40 ? "end" : "start"}
                  fontSize={13}
                  fontWeight={600}
                  fill={YOU_COLOUR}
                  stroke={CHART_COLOURS.surface}
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  You
                </text>
              </g>
            )}

            {/* Hover guide, on the series drawn */}
            {hovered && (
              <g className="earnings-hover" pointerEvents="none">
                <line x1={x(hovered.income)} x2={x(hovered.income)} y1={top1} y2={top1 + plotH} stroke={CHART_COLOURS.noChange} strokeWidth={1} />
                <circle cx={x(hovered.income)} cy={y(hovered[view])} r={3.5} fill={series.color} />
              </g>
            )}
            <rect
              x={left}
              y={top1}
              width={plotW}
              height={plotH}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
          {hovered && (
            <div
              className="earnings-tooltip"
              style={{
                left: tipOnLeft ? undefined : tipLeft + 12,
                right: tipOnLeft ? width - tipLeft + 12 : undefined,
                top: top1 + 8,
              }}
            >
              <ChartTooltip
                active
                payload={tooltipPayload}
                label={hovered.income}
                format={formatPounds}
                labelFormat={(v) => `Salary ${formatPounds(v)}, ${yearLabel}`}
                grouped={false}
                showZero
              />
            </div>
          )}
        </div>
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

export { valueAt, changeTicks };

/** The earnings chart's panels, in px: net income on top, the change below. */
export function earningsLayout(narrow) {
  return { topH: narrow ? 210 : 250, gap: 28, bottomH: narrow ? 120 : 140, axisH: 44, top1: 12 };
}

/**
 * The earnings chart's height, which the marginal tax rate chart beside it
 * takes too, so their x-axes line up.
 */
export function earningsChartHeight(narrow) {
  const { topH, gap, bottomH, axisH, top1 } = earningsLayout(narrow);
  return top1 + topH + gap + bottomH + axisH;
}

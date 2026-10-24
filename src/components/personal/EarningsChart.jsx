import { useMemo, useRef, useState } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import { GRID_PROPS, TICK_STYLE, AXIS_TITLE_STYLE, axisWidth, useNarrowViewport } from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort, roundTicks } from "../../utils/exampleHouseholds";
import { netIncomeDrops, sweepPoints } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";

export const BEFORE_COLOUR = "#9CA3AF";
export const AFTER_COLOUR = "#319795";
const LOSS_COLOUR = "#D97706";
const ZERO_LINE = "#374151";
const YOU_COLOUR = "#374151";
const DROP_FILL = "#F3F4F6";
const BEFORE_DASH = "6 4";

export const LEGEND_ITEMS = [
  { label: "Before the selected policies", color: BEFORE_COLOUR, type: "line", dash: BEFORE_DASH },
  { label: "After the selected policies", color: AFTER_COLOUR, type: "line" },
];
const DROP_ITEM = { label: "Net income falls as salary rises", color: "#E5E7EB" };

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
 * Across earnings: the household's net income before and after the
 * selected policies as the salary varies (top), and the change (bottom),
 * on one salary axis. A dashed line marks "You"; the figures at your
 * salary are the headline tiles, so the label says only "You". Where net
 * income after the policies falls as salary rises by more than £100 a
 * step, the band is shaded.
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
  const width = measured > 0 ? measured : narrow ? 358 : 900;
  const title = `Net income across earnings, ${yearLabel}`;

  const points = useMemo(() => sweepPoints(sweep), [sweep]);
  const drops = useMemo(() => netIncomeDrops(points), [points]);

  const xTicks = roundTicks(sweep.max);
  const xMax = xTicks[xTicks.length - 1];
  const yTicks = roundTicks(Math.max(1, ...points.map((p) => Math.max(p.before, p.after))));
  const cTicks = changeTicks(Math.max(...points.map((p) => Math.abs(p.change))));

  const left = Math.max(
    axisWidth(yTicks, formatPoundsShort),
    axisWidth(cTicks, formatPoundsShort),
  );
  const right = 20;
  const { topH, gap, bottomH, axisH, top1 } = earningsLayout(narrow);
  const top2 = top1 + topH + gap;
  const height = earningsChartHeight(narrow);
  const plotW = Math.max(width - left - right, 40);

  const x = (v) => left + (v / xMax) * plotW;
  const y1 = (v) => top1 + topH - (v / yTicks[yTicks.length - 1]) * topH;
  const cMax = cTicks[cTicks.length - 1];
  const y2 = (v) => top2 + bottomH / 2 - (v / cMax) * (bottomH / 2);

  const youX = salary !== null && salary <= xMax ? x(salary) : null;
  const youNet = salary !== null ? valueAt(points, salary, "after") : null;

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
  const legendItems = drops.length ? [...LEGEND_ITEMS, DROP_ITEM] : LEGEND_ITEMS;

  const download = {
    chartRef,
    name: `net-income-across-earnings-${yearLabel}`,
    exportOptions: {
      title,
      description: `Your household's net income in ${yearLabel} as your salary varies, before and after the selected policies, and the change.`,
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

  // The shared tooltip, fed the hovered point
  const tooltipPayload = hovered
    ? [
        { dataKey: "before", name: "Before", value: hovered.before, color: BEFORE_COLOUR },
        { dataKey: "after", name: "After", value: hovered.after, color: AFTER_COLOUR },
        { dataKey: "change", name: "Change", value: hovered.change },
      ]
    : [];
  const tipLeft = hovered ? x(hovered.income) : 0;
  const tipOnLeft = tipLeft > width * 0.6;

  return (
    <div className="card single-year-card">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          <p className="chart-description">
            Your household&apos;s net income as your salary varies, with partner income and everything else held fixed.
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={wrapperRef} className="earnings-plot chart-plot">
        <div ref={chartRef} className="earnings-plot-inner">
          <svg
            className="earnings-svg"
            width={width}
            height={height}
            role="img"
            aria-label={`${title}. Net income before and after the selected policies, and the change, for salaries from £0 to ${formatPounds(xMax)}.`}
          >
            {/* Bands where net income falls as salary rises */}
            {drops.map((drop) => (
              <rect
                key={drop.from}
                className="earnings-drop"
                x={x(drop.from)}
                y={top1}
                width={Math.max(x(drop.to) - x(drop.from), 1)}
                height={topH}
                fill={DROP_FILL}
              />
            ))}

            {/* Gridlines and tick labels, top panel */}
            {yTicks.map((tick) => (
              <g key={`y1-${tick}`}>
                <line x1={left} x2={left + plotW} y1={y1(tick)} y2={y1(tick)} stroke={GRID_PROPS.stroke} />
                <text x={left - 8} y={y1(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                  {formatPoundsShort(tick)}
                </text>
              </g>
            ))}
            {/* Bottom panel */}
            {cTicks.map((tick) => (
              <g key={`y2-${tick}`}>
                <line
                  x1={left}
                  x2={left + plotW}
                  y1={y2(tick)}
                  y2={y2(tick)}
                  stroke={tick === 0 ? ZERO_LINE : GRID_PROPS.stroke}
                />
                <text x={left - 8} y={y2(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                  {formatPoundsShort(tick)}
                </text>
              </g>
            ))}
            <ChartUnitLabel text="Net income (£ a year)" yAxisMap={{ 0: { x: 0, y: top1, height: topH } }} />
            <ChartUnitLabel text="Change (£ a year)" yAxisMap={{ 0: { x: 0, y: top2, height: bottomH } }} />

            {/* Change, as areas from zero */}
            <path d={areaPath(points, x, y2, 1)} fill={AFTER_COLOUR} fillOpacity={0.6} stroke="none" />
            <path d={areaPath(points, x, y2, -1)} fill={LOSS_COLOUR} fillOpacity={0.6} stroke="none" />

            {/* Net income lines */}
            <path d={linePath(points, x, y1, "before")} fill="none" stroke={BEFORE_COLOUR} strokeWidth={2.5} strokeDasharray={BEFORE_DASH} />
            <path d={linePath(points, x, y1, "after")} fill="none" stroke={AFTER_COLOUR} strokeWidth={2.5} />

            {/* X axis */}
            <line x1={left} x2={left + plotW} y1={top2 + bottomH} y2={top2 + bottomH} stroke="#D1D5DB" />
            {xTicks.map((tick) => (
              <text key={`x-${tick}`} x={x(tick)} y={top2 + bottomH + 18} textAnchor="middle" {...TICK_STYLE}>
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
                <line x1={youX} x2={youX} y1={top1} y2={top2 + bottomH} stroke={YOU_COLOUR} strokeWidth={1.25} strokeDasharray="4 3" />
                {youNet !== null && <circle cx={youX} cy={y1(youNet)} r={5} fill={AFTER_COLOUR} stroke="#fff" strokeWidth={2} />}
                <text
                  x={youX + (youX > left + plotW - 40 ? -6 : 6)}
                  y={top1 + 12}
                  textAnchor={youX > left + plotW - 40 ? "end" : "start"}
                  fontSize={13}
                  fontWeight={600}
                  fill={YOU_COLOUR}
                  stroke="#fff"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  You
                </text>
              </g>
            )}

            {/* Hover guide */}
            {hovered && (
              <g className="earnings-hover" pointerEvents="none">
                <line x1={x(hovered.income)} x2={x(hovered.income)} y1={top1} y2={top2 + bottomH} stroke="#9CA3AF" strokeWidth={1} />
                <circle cx={x(hovered.income)} cy={y1(hovered.before)} r={3.5} fill={BEFORE_COLOUR} />
                <circle cx={x(hovered.income)} cy={y1(hovered.after)} r={3.5} fill={AFTER_COLOUR} />
              </g>
            )}
            <rect
              x={left}
              y={top1}
              width={plotW}
              height={top2 + bottomH - top1}
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
                labelFormat={(v) => `Salary ${formatPounds(v)}`}
                grouped={false}
                netKey="change"
                netLabel="Change"
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

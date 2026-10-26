import { useMemo, useRef, useState } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import { GRID_PROPS, TICK_STYLE, AXIS_TITLE_STYLE, axisWidth, useNarrowViewport, CHART_COLOURS, sweepAxis, divergingAxis, BEFORE_DASH, REFERENCE_DASH } from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort, roundTicks } from "../../utils/exampleHouseholds";
import { netIncomeDrops, sweepPoints } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import TitleIcon from "../TitleIcon";

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
// The change card's key, as the population charts colour a gain and a loss
export const CHANGE_LEGEND_ITEMS = [
  { label: "Higher net income", color: AFTER_COLOUR },
  { label: "Lower net income", color: LOSS_COLOUR },
];
const X_LABEL = "Employment income";

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
 * Across earnings, as two cards: the household's net income before and
 * after the selected policies as the salary varies (`panel="net"`), and the
 * change (`panel="change"`), on the same salary axis. A dashed line marks
 * "You"; the figures at your salary are the headline tiles, so the label
 * says only "You". On the net income card, where net income after the
 * policies falls as salary rises by more than £100 a step, the band is
 * shaded, and a note says when the two lines coincide.
 *
 * @param {Object} props
 * @param {"net"|"change"} props.panel - Which card
 * @param {Object} props.sweep - normaliseHouseholdImpact's sweep
 * @param {number|null} props.salary - The salary used, in the year
 * @param {string} props.yearLabel - "2029-30"
 */
export default function EarningsChart({ panel = "net", sweep, salary, yearLabel }) {
  const isNet = panel === "net";
  const narrow = useNarrowViewport();
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);
  const width = measured > 0 ? measured : narrow ? 358 : 560;
  const title = isNet ? `Household net income, ${yearLabel}` : `Net income change, ${yearLabel}`;

  const points = useMemo(() => sweepPoints(sweep), [sweep]);
  const drops = useMemo(() => (isNet ? netIncomeDrops(points) : []), [isNet, points]);
  // The change is under 1% of net income at every salary: the lines coincide
  const linesOverlap =
    points.length > 0 &&
    points.every((p) => Math.abs(p.change) < 0.01 * Math.max(Math.abs(p.before), 1));

  const { domain: xDomain, ticks: xTicks } = sweepAxis(sweep.max);
  const xMax = xDomain[1];
  const yTicks = isNet
    ? roundTicks(Math.max(1, ...points.map((p) => Math.max(p.before, p.after))))
    : divergingAxis(points.map((p) => Math.round(p.change * 100) / 100)).ticks;
  const yLo = isNet ? 0 : yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const left = axisWidth(yTicks, formatPoundsShort);
  const right = 16;
  const { plotH, axisH, top } = earningsLayout(narrow);
  const height = earningsChartHeight(narrow);
  const plotW = Math.max(width - left - right, 40);

  const x = (v) => left + (v / xMax) * plotW;
  const y = (v) => top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const youX = salary !== null && salary <= xMax ? x(salary) : null;
  const youValue = salary !== null ? valueAt(points, salary, isNet ? "after" : "change") : null;

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
  const legendItems = isNet
    ? drops.length
      ? [...LEGEND_ITEMS, DROP_ITEM]
      : LEGEND_ITEMS
    : CHANGE_LEGEND_ITEMS;
  const description = isNet
    ? "Your household's net income as your salary varies, with partner income and everything else held fixed."
    : "How much the selected policies add to or take from your household's net income at each salary.";

  const download = {
    chartRef,
    name: `${isNet ? "household-net-income" : "net-income-change"}-${yearLabel}`,
    exportOptions: {
      title,
      description: isNet
        ? `Your household's net income in ${yearLabel} as your salary varies, before and after the selected policies.`
        : `The change in your household's net income in ${yearLabel} from the selected policies, as your salary varies.`,
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
        columns: isNet
          ? [
              { key: "income", label: "Employment income (£)", decimals: 0 },
              { key: "before", label: "Net income before (£)", decimals: 2 },
              { key: "after", label: "Net income after (£)", decimals: 2 },
              { key: "change", label: "Change (£)", decimals: 2 },
            ]
          : [
              { key: "income", label: "Employment income (£)", decimals: 0 },
              { key: "change", label: "Change in net income (£)", decimals: 2 },
            ],
        rows: points,
      }),
  };

  // The shared tooltip, fed the hovered point
  const tooltipPayload = !hovered
    ? []
    : isNet
      ? [
          { dataKey: "before", name: "Before", value: hovered.before, color: BEFORE_COLOUR },
          { dataKey: "after", name: "After", value: hovered.after, color: AFTER_COLOUR },
          { dataKey: "change", name: "Change", value: hovered.change },
        ]
      : [{ dataKey: "change", name: "Change in net income", value: hovered.change, color: hovered.change < 0 ? LOSS_COLOUR : AFTER_COLOUR }];
  const tipLeft = hovered ? x(hovered.income) : 0;
  const tipOnLeft = tipLeft > width * 0.6;
  const axisY = isNet ? y(0) : top + plotH;

  return (
    <div className="card single-year-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="trend" />
            <span className="title-text">{title}</span>
          </h3>
          <p className="chart-description">{description}</p>
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
            aria-label={
              isNet
                ? `${title}. Net income before and after the selected policies, for employment incomes from £0 to ${formatPounds(xMax)}.`
                : `${title}. The change in net income from the selected policies, for employment incomes from £0 to ${formatPounds(xMax)}.`
            }
          >
            {/* Bands where net income falls as salary rises */}
            {drops.map((drop) => (
              <rect
                key={drop.from}
                className="earnings-drop"
                x={x(drop.from)}
                y={top}
                width={Math.max(x(drop.to) - x(drop.from), 1)}
                height={plotH}
                fill={DROP_FILL}
              />
            ))}

            {/* Gridlines and tick labels */}
            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={left}
                  x2={left + plotW}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={!isNet && tick === 0 ? ZERO_LINE : GRID_PROPS.stroke}
                />
                <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                  {formatPoundsShort(tick)}
                </text>
              </g>
            ))}
            <ChartUnitLabel
              text={isNet ? "Household net income" : "Change in net income"}
              yAxisMap={{ 0: { x: 0, y: top, height: plotH } }}
            />

            {isNet ? (
              <>
                {/* Before drawn wider underneath, so it shows where the lines coincide */}
                <path d={linePath(points, x, y, "before")} fill="none" stroke={BEFORE_COLOUR} strokeWidth={4} strokeDasharray={BEFORE_DASH} />
                <path d={linePath(points, x, y, "after")} fill="none" stroke={AFTER_COLOUR} strokeWidth={2} />
              </>
            ) : (
              <>
                <path d={areaPath(points, x, y, 1)} fill={AFTER_COLOUR} fillOpacity={0.6} stroke="none" />
                <path d={areaPath(points, x, y, -1)} fill={LOSS_COLOUR} fillOpacity={0.6} stroke="none" />
              </>
            )}

            {/* X axis */}
            <line x1={left} x2={left + plotW} y1={axisY} y2={axisY} stroke={CHART_COLOURS.axis} />
            {xTicks.map((tick) => (
              <text key={`x-${tick}`} x={x(tick)} y={top + plotH + 18} textAnchor="middle" {...TICK_STYLE}>
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
              {X_LABEL}
            </text>

            {/* You */}
            {youX !== null && (
              <g className="earnings-you">
                <line x1={youX} x2={youX} y1={top} y2={top + plotH} stroke={YOU_COLOUR} strokeWidth={1.25} strokeDasharray={REFERENCE_DASH} />
                {youValue !== null && (
                  <circle
                    cx={youX}
                    cy={y(youValue)}
                    r={5}
                    fill={!isNet && youValue < 0 ? LOSS_COLOUR : AFTER_COLOUR}
                    stroke={CHART_COLOURS.surface}
                    strokeWidth={2}
                  />
                )}
                <text
                  x={youX + (youX > left + plotW - 40 ? -6 : 6)}
                  y={top + 12}
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

            {/* Hover guide */}
            {hovered && (
              <g className="earnings-hover" pointerEvents="none">
                <line x1={x(hovered.income)} x2={x(hovered.income)} y1={top} y2={top + plotH} stroke={CHART_COLOURS.noChange} strokeWidth={1} />
                {isNet ? (
                  <>
                    <circle cx={x(hovered.income)} cy={y(hovered.before)} r={3.5} fill={BEFORE_COLOUR} />
                    <circle cx={x(hovered.income)} cy={y(hovered.after)} r={3.5} fill={AFTER_COLOUR} />
                  </>
                ) : (
                  <circle cx={x(hovered.income)} cy={y(hovered.change)} r={3.5} fill={hovered.change < 0 ? LOSS_COLOUR : AFTER_COLOUR} />
                )}
              </g>
            )}
            <rect
              x={left}
              y={top}
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
                top: top + 8,
              }}
            >
              <ChartTooltip
                active
                payload={tooltipPayload}
                label={hovered.income}
                format={formatPounds}
                labelFormat={(v) => `${X_LABEL} ${formatPounds(v)}, ${yearLabel}`}
                grouped={false}
                netKey={isNet ? "change" : undefined}
                netLabel={isNet ? "Change" : undefined}
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
      {isNet && linesOverlap && (
        <p className="chart-note chart-footer">The lines overlap: the change is under 1% of income.</p>
      )}
    </div>
  );
}

export { valueAt };

/** Each earnings card's plot, in px: the plot, then the x axis below it. */
export function earningsLayout(narrow) {
  return { plotH: narrow ? 300 : 340, axisH: 44, top: 12 };
}

/**
 * An earnings card's height, which the marginal tax rate chart takes too,
 * so the cards read alike.
 */
export function earningsChartHeight(narrow) {
  const { plotH, axisH, top } = earningsLayout(narrow);
  return top + plotH + axisH;
}

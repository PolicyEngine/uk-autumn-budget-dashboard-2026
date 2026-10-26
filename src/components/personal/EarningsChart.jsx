import { useMemo, useRef, useState } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_TITLE_STYLE,
  axisWidth,
  useNarrowViewport,
  CHART_COLOURS,
  sweepAxis,
  divergingAxis,
  zeroBasedAxis,
  BEFORE_DASH,
  REFERENCE_DASH,
} from "../../utils/chartTheme";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { formatPounds, formatPoundsShort } from "../../utils/exampleHouseholds";
import { netIncomeDrops, sweepPoints } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import TitleIcon from "../TitleIcon";
import ViewSwitch from "../ViewSwitch";
import { CHART_VIEWS } from "./chartViews";
import { layerLegendItems, layerRows, layersInUse, stackLayers } from "./netIncomeParts";

export const BEFORE_COLOUR = CHART_COLOURS.before;
export const AFTER_COLOUR = CHART_COLOURS.gain;
const LOSS_COLOUR = CHART_COLOURS.loss;
const ZERO_LINE = CHART_COLOURS.text;
const YOU_COLOUR = CHART_COLOURS.text;
const DROP_FILL = CHART_COLOURS.mutedFill;
// Over the stacked layers the total is drawn in ink, as on the marginal
// rate card
const TOTAL_COLOUR = CHART_COLOURS.ink;
const TOTAL_NAME = { before: "Net income before", after: "Net income after", change: "Change in net income" };

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

/** A stacked layer's band: its top edge left to right, its foot back. */
const bandPath = (rows, band, x, y) => {
  const topEdge = rows.map((row, i) => `${i ? "L" : "M"}${x(row.income).toFixed(2)},${y(band[i].hi).toFixed(2)}`);
  const foot = rows
    .map((row, i) => `L${x(row.income).toFixed(2)},${y(band[i].lo).toFixed(2)}`)
    .reverse();
  return `${topEdge.join("")}${foot.join("")}Z`;
};

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
 * Across earnings, one card with three views chosen above the plot, as the
 * marginal rate card beside it: "Before" and "After" the selected policies,
 * net income as the salary varies, and "Change", what the policies add or
 * take at each salary. When the API sends net income's parts, each view is
 * stacked by programme in the marginal rate card's colours (income and
 * benefits above zero, taxes below), with the total in ink over them; else
 * the total alone. A dashed line marks "You" in every view; the figures at
 * your salary are the headline tiles, so the label says only "You". Where
 * net income falls as salary rises by more than £100 a step, the band is
 * shaded. The legend, tooltip and CSV/PNG download follow the view shown.
 *
 * @param {Object} props
 * @param {"before"|"after"|"change"} [props.initialView] - The view it opens on
 * @param {Object} props.sweep - normaliseHouseholdImpact's sweep
 * @param {number|null} props.salary - The salary used, in the year
 * @param {string} props.yearLabel - "2029-30"
 */
export default function EarningsChart({ initialView = "after", sweep, salary, yearLabel }) {
  const [view, setView] = useState(initialView);
  const isChange = view === "change";
  const narrow = useNarrowViewport();
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);
  const width = measured > 0 ? measured : narrow ? 358 : 560;
  const title = `Household net income, ${yearLabel}`;
  // The file and image name the view shown
  const viewTitle = isChange ? `Net income change, ${yearLabel}` : title;

  const points = useMemo(() => sweepPoints(sweep), [sweep]);
  const netParts = sweep.netParts ?? null;
  // The view's rows, by programme when the API sends the parts
  const rows = useMemo(
    () => (netParts ? layerRows(points, netParts, view) : points.map((p) => ({ income: p.income, total: isChange ? p.change : p[view] }))),
    [points, netParts, view, isChange],
  );
  // The layers in use before or after, so switching between them keeps the
  // legend; the change's own layers in Change
  const layers = useMemo(() => {
    if (!netParts) return [];
    if (isChange) return layersInUse(rows);
    return layersInUse([...layerRows(points, netParts, "before"), ...layerRows(points, netParts, "after")]);
  }, [netParts, isChange, rows, points]);
  const stack = useMemo(() => stackLayers(rows, layers), [rows, layers]);
  const drops = useMemo(
    () => (isChange ? [] : netIncomeDrops(points.map((p) => ({ income: p.income, after: p[view] })))),
    [isChange, points, view],
  );
  // The change is under 1% of net income at every salary
  const smallChange =
    points.length > 0 &&
    points.every((p) => Math.abs(p.change) < 0.01 * Math.max(Math.abs(p.before), 1));

  const { domain: xDomain, ticks: xTicks } = sweepAxis(sweep.max);
  const xMax = xDomain[1];
  // Before and After share one axis, so switching between them moves nothing
  const levelReach = useMemo(() => {
    if (isChange) return null;
    const sides = ["before", "after"].map((side) =>
      netParts ? stackLayers(layerRows(points, netParts, side), layers) : null,
    );
    return [
      ...points.flatMap((p) => [p.before, p.after]),
      ...sides.flatMap((side) => (side ? [side.top, side.bottom] : [])),
    ];
  }, [isChange, netParts, points, layers]);
  const yTicks = isChange
    ? divergingAxis([...points.map((p) => Math.round(p.change * 100) / 100), stack.top, stack.bottom]).ticks
    : zeroBasedAxis(levelReach).ticks;
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const left = axisWidth(yTicks, formatPoundsShort);
  const right = 16;
  const { plotH, top } = earningsLayout(narrow);
  const height = earningsChartHeight(narrow);
  const plotW = Math.max(width - left - right, 40);

  const x = (v) => left + (v / xMax) * plotW;
  const y = (v) => top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const youX = salary !== null && salary <= xMax ? x(salary) : null;
  const youValue = salary !== null ? valueAt(rows, salary, "total") : null;

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const income = ((px - left) / plotW) * xMax;
    let best = 0;
    rows.forEach((p, i) => {
      if (Math.abs(p.income - income) < Math.abs(rows[best].income - income)) best = i;
    });
    setHover(best);
  };

  const hovered = hover !== null ? rows[hover] : null;
  // Without the parts: one line, coloured as before or after, or the
  // change's gain and loss
  const sideColour = view === "before" ? BEFORE_COLOUR : AFTER_COLOUR;
  const lineColour = netParts ? TOTAL_COLOUR : sideColour;
  const dotColour = (value) => (netParts ? TOTAL_COLOUR : isChange ? (value < 0 ? LOSS_COLOUR : AFTER_COLOUR) : sideColour);
  const totalItem = { label: TOTAL_NAME[view], color: TOTAL_COLOUR, type: "line" };
  const legendItems = [
    ...(netParts
      ? [...layerLegendItems(layers), totalItem]
      : isChange
        ? CHANGE_LEGEND_ITEMS
        : [view === "before" ? LEGEND_ITEMS[0] : LEGEND_ITEMS[1]]),
    ...(drops.length ? [DROP_ITEM] : []),
  ];
  const sideWords = view === "before" ? "before the selected policies" : "after the selected policies";
  const description = isChange
    ? `How much the selected policies add to or take from your household's net income at each salary${netParts ? ", by the tax or benefit that changes" : ""}, with partner income and everything else held fixed.`
    : `Your household's net income ${sideWords} as your salary varies${netParts ? ": income and benefits above zero, taxes below" : ""}, with partner income and everything else held fixed.`;

  const layerColumns = layers.map((layer) => ({
    key: layer.key,
    label: `${layer.label}${isChange ? ", change" : ""} (£)`,
    decimals: 2,
  }));
  const download = {
    chartRef,
    name: `${isChange ? "net-income-change" : `household-net-income-${view}`}-${yearLabel}`,
    exportOptions: {
      title: viewTitle,
      description: isChange
        ? `The change in your household's net income in ${yearLabel} from the selected policies, as your salary varies${netParts ? ", by programme" : ""}.`
        : `Your household's net income in ${yearLabel} ${sideWords} as your salary varies${netParts ? ", by programme" : ""}.`,
      legendItems: legendItems.map(({ info, ...item }) => ({ ...item, type: item.type ?? "rect" })),
      logo: CHART_LOGO,
      svgSelector: "svg.earnings-svg",
      reservedLegendHeight: 0,
    },
    csv: () =>
      buildChartCsv({
        title: viewTitle,
        units: "£ a year; taxes negative",
        source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
        columns: [
          { key: "income", label: "Employment income (£)", decimals: 0 },
          ...layerColumns,
          { key: "total", label: `${TOTAL_NAME[view]} (£)`, decimals: 2 },
        ],
        rows,
      }),
  };

  // The shared tooltip, fed the hovered point: each layer's £, then the total
  const tooltipPayload = !hovered
    ? []
    : [
        ...layers
          .filter((layer) => Math.abs(hovered[layer.key] ?? 0) >= 0.5)
          .map((layer) => ({
            dataKey: `layer-${layer.key}`,
            name: layer.label,
            value: hovered[layer.key],
            color: layer.color,
          })),
        { dataKey: "total", name: TOTAL_NAME[view], value: hovered.total, color: dotColour(hovered.total) },
      ];
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
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={viewTitle} />
      </div>
      <div className="chart-view-switch chart-controls">
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
            aria-label={
              isChange
                ? `${viewTitle}. The change in net income from the selected policies${netParts ? ", by programme" : ""}, for employment incomes from £0 to ${formatPounds(xMax)}.`
                : `${viewTitle}. Net income ${sideWords}${netParts ? ", by programme" : ""}, for employment incomes from £0 to ${formatPounds(xMax)}.`
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
                  stroke={tick === 0 && yLo < 0 ? ZERO_LINE : GRID_PROPS.stroke}
                />
                <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                  {formatPoundsShort(tick)}
                </text>
              </g>
            ))}
            <ChartUnitLabel
              text={isChange ? "Change in net income" : "Household net income"}
              yAxisMap={{ 0: { x: 0, y: top, height: plotH } }}
            />

            {/* The layers, stacked outward from zero */}
            {layers.map((layer) => (
              <path
                key={layer.key}
                className="earnings-layer"
                data-layer={layer.key}
                d={bandPath(rows, stack.bands[layer.key], x, y)}
                fill={layer.color}
                fillOpacity={0.85}
                stroke="none"
              />
            ))}

            {!netParts && isChange ? (
              <>
                <path d={areaPath(points, x, y, 1)} fill={AFTER_COLOUR} fillOpacity={0.6} stroke="none" />
                <path d={areaPath(points, x, y, -1)} fill={LOSS_COLOUR} fillOpacity={0.6} stroke="none" />
              </>
            ) : (
              <path
                className="earnings-total"
                d={linePath(rows, x, y, "total")}
                fill="none"
                stroke={lineColour}
                strokeWidth={netParts ? 2.5 : 2}
                strokeDasharray={!netParts && view === "before" ? BEFORE_DASH : undefined}
              />
            )}

            {/* X axis */}
            <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke={CHART_COLOURS.axis} />
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
                    fill={dotColour(youValue)}
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
                <circle cx={x(hovered.income)} cy={y(hovered.total)} r={3.5} fill={dotColour(hovered.total)} />
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
                netKey={netParts ? "total" : undefined}
                netLabel={TOTAL_NAME[view]}
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
      {isChange && smallChange && (
        <p className="chart-note chart-footer">The change is under 1% of net income at every salary.</p>
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

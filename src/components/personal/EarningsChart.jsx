import { useMemo, useRef, useState } from "react";
import NoBreakYear from "../NoBreakYear";
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
import ChartMoreInfo from "../ChartMoreInfo";
import { METHOD_ANCHORS } from "../methodology/anchors";
import { netIncomeDrops, sweepPoints } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import SeriesToggle from "../SeriesToggle";
import TitleIcon from "../TitleIcon";
import ControlBar from "../ControlBar";
import { CHART_VIEWS } from "./chartViews";
import { layerLegendItems, layerRows, layersInUse, stackLayers } from "./netIncomeParts";
import { SWEEP_COMPONENTS, hiddenParts, sweepChips } from "./sweepComponents";

export const BEFORE_COLOUR = CHART_COLOURS.before;
export const AFTER_COLOUR = CHART_COLOURS.gain;
const LOSS_COLOUR = CHART_COLOURS.loss;
const ZERO_LINE = CHART_COLOURS.text;
const YOU_COLOUR = CHART_COLOURS.text;
const DROP_FILL = CHART_COLOURS.mutedFill;
// Over the stacked layers the total is drawn in ink, as on the marginal
// rate card
const TOTAL_COLOUR = CHART_COLOURS.ink;
const TOTAL_NAME = { before: "Net income under current law", after: "Net income with the policies", change: "Change in net income" };

export const LEGEND_ITEMS = [
  { label: "Under current law", color: BEFORE_COLOUR, type: "line", dash: BEFORE_DASH },
  { label: "With the selected policies", color: AFTER_COLOUR, type: "line" },
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
 * The salary and £ value under the pointer, from its offset within the plot
 * area (px from the plot's left, py from its top). Pavel's review (HH7): the
 * margin was taken off twice, so the hover trailed the pointer and the
 * right end of the axis could not be reached.
 */
export function pointerOnPlot(px, py, { plotW, plotH, xMax, yLo, yHi }) {
  return {
    income: (px / plotW) * xMax,
    value: yLo + ((plotH - py) / plotH) * (yHi - yLo),
  };
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
 * @param {Object} [props.sync] - Shared with the marginal rate card beside
 *   it (SingleYearResults' AcrossEarnings): { view, setView, hidden (component
 *   keys switched off), setHidden, hover: {income, card} | null, setHover }
 */
// Headroom past the furthest value on each side of the y axis
const Y_HEADROOM = 0.1;

/** An axis's ticks, extended by its own step until they cover its domain. */
export function ticksToDomain({ domain, ticks }) {
  if (ticks.length < 2) return ticks;
  const step = ticks[1] - ticks[0];
  const out = [...ticks];
  const clean = (v) => Math.round(v * 1e9) / 1e9 || 0;
  while (out[0] > domain[0] + step * 1e-9) out.unshift(clean(out[0] - step));
  while (out[out.length - 1] < domain[1] - step * 1e-9) out.push(clean(out[out.length - 1] + step));
  return out;
}

export default function EarningsChart({ initialView = "after", sweep, salary, yearLabel, sync = null }) {
  const [ownView, setOwnView] = useState(initialView);
  const view = sync?.view ?? ownView;
  const setView = sync?.setView ?? setOwnView;
  const isChange = view === "change";
  const narrow = useNarrowViewport();
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);
  // The layers (and the total line) hidden from the chips, and the one the
  // pointer or a chip is on, which comes forward while the rest dim
  const [ownHidden, setOwnHidden] = useState([]);
  // Components switched off (shared with the marginal rate card), as this
  // card's layers, and the total line
  const hiddenKeys = sync?.hidden ?? ownHidden;
  const setHiddenKeys = sync?.setHidden ?? setOwnHidden;
  const hidden = useMemo(
    () => [...hiddenParts("net", hiddenKeys), ...(hiddenKeys.includes("total") ? ["total"] : [])],
    [hiddenKeys],
  );
  // The chip hovered, shared with the marginal rate card when the two
  // have one Show control (`sync.focus`)
  const [ownFocus, setOwnFocus] = useState(null);
  const focus = sync?.setFocus ? sync.focus : ownFocus;
  const setFocus = sync?.setFocus ?? setOwnFocus;
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
  const shownLayers = useMemo(() => layers.filter((layer) => !hidden.includes(layer.key)), [layers, hidden]);
  const totalShown = !hidden.includes("total");
  const stack = useMemo(() => stackLayers(rows, shownLayers), [rows, shownLayers]);
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
  // The change's axis: symmetric about £0 (gains above, losses below), so
  // a change that is the same at every salary reads as a band above zero,
  // not as a block filling the plot
  // Your own point is on the axis too, and every end has 10% headroom, so
  // neither the area nor the "You" dot is cut at the plot's edge. The plot
  // runs to the axis's domain, not its last tick (the domain can sit half a
  // step past it).
  const youAt = salary !== null ? valueAt(rows, salary, "total") : null;
  const changeReach = Math.max(
    Math.abs(stack.top),
    Math.abs(stack.bottom),
    ...points.map((p) => Math.abs(p.change)),
    youAt == null ? 0 : Math.abs(youAt),
    1,
  );
  const yAxis = isChange
    ? divergingAxis([changeReach, -changeReach], { pad: Y_HEADROOM })
    : zeroBasedAxis([...levelReach, youAt], { pad: Y_HEADROOM });
  // Ticks out to both ends, so the top value is always labelled above
  // the highest point (+£110 reads against a £150 tick, not a £100 one)
  const yTicks = ticksToDomain(yAxis);
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
  const youValue = youAt;

  const onMove = (event) => {
    // The hover rect is the plot itself (x = left, y = top), so the pointer
    // is already relative to the plot: no margin to take off again
    const rect = event.currentTarget.getBoundingClientRect();
    const { income, value } = pointerOnPlot(event.clientX - rect.left, event.clientY - rect.top, { plotW, plotH, xMax, yLo, yHi });
    let best = 0;
    rows.forEach((p, i) => {
      if (Math.abs(p.income - income) < Math.abs(rows[best].income - income)) best = i;
    });
    setHover(best);
    sync?.setHover({ income: rows[best].income, card: "net" });
    // The layer under the pointer, if any: its band at this salary holds
    // the pointer's value
    const under = shownLayers.find((layer) => {
      const band = stack.bands[layer.key]?.[best];
      return band && value >= Math.min(band.lo, band.hi) && value <= Math.max(band.lo, band.hi) && Math.abs(band.hi - band.lo) > 0;
    });
    setPointerLayer(under ? under.key : null);
  };

  const [pointerLayer, setPointerLayer] = useState(null);
  // The chips: every component both cards share, in one order, those
  // with nothing here disabled so the two keys line up
  const chips = useMemo(
    () => sweepChips("net", new Set(layers.map((layer) => layer.key)), { label: TOTAL_NAME[view], colour: TOTAL_COLOUR }, sync?.union ?? null),
    [layers, view, sync?.union],
  );
  const membersOf = (key) => SWEEP_COMPONENTS.find((component) => component.key === key)?.net ?? [key];
  const highlightedKeys = focus ? membersOf(focus) : pointerLayer ? [pointerLayer] : [];
  const highlighted = highlightedKeys.length ? highlightedKeys : null;
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
  const sideWords = view === "before" ? "under current law" : "with the selected policies";
  // One plain sentence: your household at your salary
  const youRounded = youValue == null ? null : Math.round(youValue / 10) * 10;
  // A change within £5 of itself at every salary: said in the sentence
  const flatChange =
    points.length > 1 && Math.max(...points.map((p) => p.change)) - Math.min(...points.map((p) => p.change)) < 5;
  // With no earnings there is no salary to name
  const at = salary === 0 ? "With no earnings" : `At your ${formatPounds(salary)} salary`;
  const youSentence =
    youValue == null || salary === null
      ? null
      : isChange
        ? youRounded === 0
          ? `${at}, the selected policies barely change your household's net income.`
          : `${at}, the selected policies ${youRounded > 0 ? "add" : "take"} about ${formatPounds(Math.abs(youRounded))} a year ${youRounded > 0 ? "to" : "from"} your household's net income${flatChange ? ", about the same at every salary" : ""}.`
        : `${at}, your household's net income is about ${formatPounds(Math.round(youValue / 10) * 10)} a year ${sideWords}.`;
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
  // On a layer: that layer alone ("At £40k: Income tax −£5,486")
  const layerTip = hovered && pointerLayer ? layers.find((layer) => layer.key === pointerLayer) : null;
  const tooltipPayload = !hovered
    ? []
    : layerTip
      ? [{ dataKey: `layer-${layerTip.key}`, name: layerTip.label, value: hovered[layerTip.key] ?? 0, color: layerTip.color }]
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
          {/* One plain sentence at your salary; what the chart shows is in
              About this chart */}
          <p className="chart-description">{youSentence ?? description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={viewTitle} />
      </div>
      <div className="chart-view-switch chart-controls">
        {/* The view in the card's Options pill, as on every other page */}
        <ControlBar name={title} options={[{ label: "View", value: view, onChange: setView, options: CHART_VIEWS }]} />
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
            {shownLayers.map((layer) => (
              <path
                key={layer.key}
                className="earnings-layer"
                data-layer={layer.key}
                d={bandPath(rows, stack.bands[layer.key], x, y)}
                fill={layer.color}
                fillOpacity={highlighted ? (highlighted.includes(layer.key) ? 0.95 : 0.2) : isChange ? 0.55 : 0.85}
                stroke="none"
                style={{ transition: "fill-opacity 0.15s ease" }}
              />
            ))}

            {!netParts && isChange ? (
              <>
                <path d={areaPath(points, x, y, 1)} fill={AFTER_COLOUR} fillOpacity={0.6} stroke="none" />
                <path d={areaPath(points, x, y, -1)} fill={LOSS_COLOUR} fillOpacity={0.6} stroke="none" />
              </>
            ) : totalShown && (
              <path
                className="earnings-total"
                d={linePath(rows, x, y, "total")}
                fill="none"
                stroke={lineColour}
                strokeWidth={netParts ? 2.5 : 2}
                strokeOpacity={highlighted && !highlighted.includes("total") ? 0.3 : 1}
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
                  {/* "You: £18,010", as the marginal rate card's "You: 28%" */}
                  {youValue === null
                    ? "You"
                    : `You: ${isChange ? `${youValue < 0 ? "−" : "+"}${formatPounds(Math.abs(Math.round(youValue / 10) * 10))}` : formatPounds(Math.round(youValue / 10) * 10)}`}
                </text>
              </g>
            )}

            {/* The salary hovered on the marginal rate card beside it */}
            {sync?.hover && sync.hover.card !== "net" && sync.hover.income <= xMax && (
              <line
                className="earnings-synced-guide"
                x1={x(sync.hover.income)}
                x2={x(sync.hover.income)}
                y1={top}
                y2={top + plotH}
                stroke={CHART_COLOURS.noChange}
                strokeWidth={1}
                pointerEvents="none"
              />
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
              onMouseLeave={() => {
                setHover(null);
                setPointerLayer(null);
                sync?.setHover(null);
              }}
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
                labelFormat={(v) => (layerTip ? `At ${formatPoundsShort(v)}` : <NoBreakYear text={`${X_LABEL} ${formatPounds(v)}, ${yearLabel}`} />)}
                grouped={false}
                netKey={netParts && !layerTip ? "total" : undefined}
                netLabel={TOTAL_NAME[view]}
                showZero
              />
            </div>
          )}
        </div>
      </div>
      <div className="single-year-legend chart-legend">
        {netParts && sync?.sharedLegend ? (
          // The Show control is above the pair; only this card's own key
          // item (the shaded bands) stays here
          drops.length > 0 && (
            <span className="series-toggle-extra">
              <span className="series-toggle-band" style={{ background: DROP_FILL }} aria-hidden="true" />
              {DROP_ITEM.label}
            </span>
          )
        ) : netParts ? (
          // The layers and the total as chips: show or hide each, hover to
          // bring one forward
          <SeriesToggle
            lead="Show:"
            label="Layers"
            series={chips}
            shown={chips.filter((chip) => !chip.disabled && !hiddenKeys.includes(chip.key)).map((chip) => chip.key)}
            onChange={(next) => {
              // This card's chips decide only their own keys; the rest stay as the other card left them
              const mine = chips.filter((chip) => !chip.disabled).map((chip) => chip.key);
              setHiddenKeys([...hiddenKeys.filter((key) => !mine.includes(key)), ...mine.filter((key) => !next.includes(key))]);
            }}
            onHover={setFocus}
            collapseDisabled
            expanded={sync?.expanded}
            onExpandedChange={sync?.setExpanded}
            narrow={narrow}
            extras={drops.length ? [{ key: "drop", label: DROP_ITEM.label, fill: DROP_FILL }] : []}
          />
        ) : (
          <GroupedLegend items={legendItems} />
        )}
      </div>
      <div className="card-logo chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {/* The same "About this chart" as the marginal rate card beside it:
          what it shows, how it is calculated, caveats */}
      <div className="chart-footer">
        <ChartMoreInfo
          info={{
            shows: description,
            how: [
              "Your household is calculated again at each salary from £0 up, with partner income and everything else held fixed.",
              netParts
                ? "Each layer is one tax or benefit's part of net income; income and benefits are above zero, taxes below, and the line is net income."
                : "The line is your household's net income.",
              "The dashed line marks your salary.",
            ],
            method: { anchor: METHOD_ANCHORS.personal, label: "How the household calculation works" },
            caveats: [
              isChange && smallChange && "The change is under 1% of net income at every salary.",
              drops.length > 0 && "In the shaded bands net income falls as salary rises: taxes and withdrawn benefits take more than the extra pay.",
            ],
          }}
        />
      </div>
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

import { useRef } from "react";
import {
  CartesianGrid,
  Customized,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import {
  CHANGE_MAX,
  CHANGE_MIN,
  SCATTER_BINS,
  toChangeAxis,
} from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  CHANGE_AXIS_DOMAIN,
  changeBandLabel,
  HOUSEHOLDS_PER_DOT,
  incomeBandLabel,
  scatterCsv,
  scatterDots,
  scatterView,
} from "../utils/householdScatter";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
} from "../utils/chartTheme";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { colourFor } from "./publication/BinnedHouseholdScatter";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./HouseholdScatterTemplate.css";

const CHART_TITLE = "Household income impacts";
const CHART_DESCRIPTION =
  "Households by baseline income and the change in it. Each dot stands for about 20,000 households in a group of similar incomes and changes, placed at random within that group.";

const pounds = (value) =>
  `${value < 0 ? "-" : ""}£${new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.abs(value))}`;
const thousands = (value) => (value === 0 ? "£0" : `£${value / 1000}k`);
const perDot = new Intl.NumberFormat("en-GB").format(HOUSEHOLDS_PER_DOT);
const households = (value) =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)} households`;

/** A shaded edge strip, named on hover ("Gains of £1,900 or more"). */
function StripRect({ x, y, width, height, fill, fillOpacity, title }) {
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return (
    <rect
      className="household-scatter-strip"
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      fillOpacity={fillOpacity}
    >
      <title>{title}</title>
    </rect>
  );
}

const KEY = [
  { label: "Gain", color: "#319795" },
  { label: "Loss", color: "#D97706" },
  { label: "No change", color: "#9CA3AF" },
];

function CellTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{households(point.households)} in this group</p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: "transparent" }} />
        <span className="chart-tooltip-name">Baseline income</span>
        <span className="chart-tooltip-value">{incomeBandLabel(point.incomeBand)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: colourFor(point) }} />
        <span className="chart-tooltip-name">Change a year</span>
        <span className="chart-tooltip-value">
          {changeBandLabel(point.changeBand, point.changeBandUpper)}
        </span>
      </div>
    </div>
  );
}

/**
 * Households by baseline net income and the change in it, from the binned
 * cells in household_scatter_binned.csv (£5,000 income bands by change
 * bands narrow near zero, from contract.scatter_bins.change_edges). The
 * change axis is symlog, so the small bands near zero and the large ones
 * both read. Each cell is drawn as about one dot per 20,000 weighted
 * households, placed at random (deterministically) inside the cell on that
 * axis, so the cloud reads as density; the no-change band is a line of dots
 * at £0, and the open-ended outer change bands sit in shaded strips beyond
 * the plotted range. No survey household is shown on its own (#30): a dot's
 * tooltip gives its cell.
 *
 * Cells are published per reform: one measure shows its own, every measure
 * the package's, and any other selection a notice.
 */
function HouseholdScatter({ selectedPolicies, policies, selectedYear = 2029 }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const data = useHouseholdScatterData();
  const { combinedId } = useMeasureCatalogue();
  const view = scatterView({
    data,
    selectedIds: selectedPolicies,
    // The package is every measure the page can show, held ones excluded
    policyIds: (policies ?? []).filter((policy) => policy.displayable !== false).map((policy) => policy.id),
    year: selectedYear,
    packageId: combinedId,
  });
  const yearLabel = fiscalYearLabel(selectedYear);
  const chartTitle = `${CHART_TITLE}, ${yearLabel}`;
  const incomeTicks = [];
  for (
    let value = SCATTER_BINS.income_min;
    value <= SCATTER_BINS.income_max;
    value += narrow ? 50000 : 25000
  ) {
    incomeTicks.push(value);
  }
  // The change axis is symlog: positions are toChangeAxis(£). The outer
  // bands, which hold every change beyond ±£5,000, sit in a marked strip
  // beyond the plotted range.
  const innerMax = toChangeAxis(CHANGE_MAX);
  const innerMin = toChangeAxis(CHANGE_MIN);
  const changeDomain = CHANGE_AXIS_DOMAIN;
  // The strips' own ticks, at their middles, name them as open-ended
  const upperTick = (innerMax + changeDomain[1]) / 2;
  const lowerTick = (innerMin + changeDomain[0]) / 2;
  const tickPounds = narrow
    ? [0, 50, 100, 500, 1000]
    : [0, 10, 50, 100, 250, 500, 1000, 2500];
  const innerPounds = [
    ...tickPounds.slice(1).map((value) => -value).reverse(),
    ...tickPounds,
  ];
  const innerTicks = innerPounds.map((value) => toChangeAxis(value));
  const poundsAt = new Map(
    [...innerPounds, CHANGE_MIN, CHANGE_MAX].map((value) => [toChangeAxis(value), value]),
  );
  const changeTick = (value) => {
    if (value === upperTick) return `≥ ${pounds(CHANGE_MAX)}`;
    if (value === lowerTick) return `≤ ${pounds(CHANGE_MIN)}`;
    return pounds(poundsAt.get(value) ?? 0);
  };
  const dots =
    view.kind === "points"
      ? scatterDots(view.points).map((dot) => ({ ...dot, fill: colourFor(dot) }))
      : [];
  const hasEdge = {
    upper: dots.some((dot) => dot.edge === "upper"),
    lower: dots.some((dot) => dot.edge === "lower"),
  };
  // A strip's tick only when the strip is drawn
  // and, without a strip, the edge itself (±£5,000) on wide screens
  const changeTicks = [
    ...(hasEdge.lower ? [lowerTick] : narrow ? [] : [innerMin]),
    ...innerTicks,
    ...(hasEdge.upper ? [upperTick] : narrow ? [] : [innerMax]),
  ];
  const dotRadius = narrow ? 1.6 : 2;

  const exportName = `household-income-impacts-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: CHART_DESCRIPTION,
    legendItems: KEY.map((item) => ({ ...item, type: "rect" })),
    logo: CHART_LOGO,
    // The key is outside the chart's SVG: the whole SVG is the plot
    reservedLegendHeight: 0,
  };
  const download =
    view.kind === "points"
      ? {
          chartRef,
          name: exportName,
          exportOptions,
          csv: () => scatterCsv(view.points, { title: chartTitle }),
        }
      : null;

  return (
    <div className="household-scatter-template">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">{CHART_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={chartTitle}
          disabledReason={
            view.kind === "points" ? undefined : "Available when results are published"
          }
        />
      </div>

      {/* Rows shared with the map beside it */}
      {/* The key sits in the row the map beside it uses for its controls */}
      <div className="chart-controls household-scatter-controls">
        <div className="scatter-key" aria-hidden="true">
          {KEY.map((item) => (
            <span key={item.label} className="scatter-key-item">
              <span className="scatter-key-dot" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
          <span className="scatter-key-item">
            <span className="scatter-key-dots" />
            Each dot: about {perDot} households
          </span>
        </div>
      </div>

      <div className="chart-plot household-scatter-template-plot" ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 360 : 383}>
          <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            {hasEdge.upper && (
              <ReferenceArea
                y1={innerMax}
                y2={changeDomain[1]}
                fill="#F3F4F6"
                fillOpacity={1}
                stroke="none"
                ifOverflow="hidden"
                shape={(props) => (
                  <StripRect {...props} title={`Gains of ${pounds(CHANGE_MAX)} or more`} />
                )}
              />
            )}
            {hasEdge.lower && (
              <ReferenceArea
                y1={changeDomain[0]}
                y2={innerMin}
                fill="#F3F4F6"
                fillOpacity={1}
                stroke="none"
                ifOverflow="hidden"
                shape={(props) => (
                  <StripRect {...props} title={`Losses of ${pounds(CHANGE_MAX)} or more`} />
                )}
              />
            )}
            <XAxis
              type="number"
              dataKey="income"
              domain={[SCATTER_BINS.income_min, SCATTER_BINS.income_max]}
              ticks={incomeTicks}
              tickFormatter={thousands}
              tick={TICK_STYLE}
              axisLine={AXIS_LINE}
              tickLine={false}
              height={48}
              label={{
                value: "Baseline household net income (£ a year)",
                position: "insideBottom",
                offset: 4,
                style: AXIS_TITLE_STYLE,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={changeDomain}
              ticks={changeTicks}
              allowDataOverflow
              tickFormatter={changeTick}
              tick={TICK_STYLE}
              axisLine={false}
              tickLine={false}
              width={axisWidth([lowerTick, ...innerTicks, upperTick], changeTick)}
              interval={0}
            />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            {view.kind === "points" && (
              <Tooltip {...TOOLTIP_PROPS} cursor={false} content={<CellTooltip />} />
            )}
            {view.kind === "points" && (
              <Scatter
                data={dots}
                isAnimationActive={false}
                shape={({ cx, cy, payload }) => (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={dotRadius}
                    fill={payload.fill}
                    fillOpacity={0.6}
                  />
                )}
              />
            )}
            <Customized component={<ChartUnitLabel text="Change in net income (£ a year)" />} />
          </ScatterChart>
        </ResponsiveContainer>
        {view.kind !== "points" && (
          <div className="household-scatter-template-note" role="status">
            <p>{view.kind === "loading" ? "Loading household results…" : view.reason}</p>
            {view.detail && <p className="household-scatter-template-detail">{view.detail}</p>}
          </div>
        )}
      </div>

      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}

export default HouseholdScatter;

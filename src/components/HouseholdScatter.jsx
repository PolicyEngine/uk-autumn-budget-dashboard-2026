import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { SCATTER_BINS, changeKind } from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  CHANGE_AXIS_DOMAIN,
  householdsPerDot,
  INCOME_AXIS_DOMAIN,
  panelDots,
  scatterCsv,
  scatterView,
} from "../utils/householdScatter";
import { useNarrowViewport, Y_TITLE_GUTTER, CHART_COLOURS } from "../utils/chartTheme";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { colourFor } from "./publication/BinnedHouseholdScatter";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./HouseholdScatterTemplate.css";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";

// The 2025 dashboard's household scatter (HouseholdChart, Autumn Budget
// 2025), drawn from the binned cells: same axes, ticks, grid, zero line,
// dot size and colours. Its dots were sampled households; these are fixed
// shares of groups of households, which keep their rows across years.
const CHART_TITLE = "Household income impacts";
const CHANGE_TICKS = [-5000, -2500, 0, 2500, 5000];
const INCOME_TICKS = [0, 20000, 40000, 60000, 80000, 100000, 120000, 140000];
const thousands = (value) => `${value / 1000}`;
// 2025: Recharts' default scatter symbol (area 64, so r ≈ 4.5) at an
// opacity of 0.5 to 0.95 by household weight, which its Cell set as both
// `opacity` and `fill-opacity` (so a dot showed at about its square).
// Every dot here stands for the same number of households, so all take
// the 2025 sample's typical value (its median, 0.51), set both ways.
const DOT_RADIUS = Math.sqrt(64 / Math.PI);
const DOT_OPACITY = 0.51;
const GRID = { strokeDasharray: "3 3", stroke: CHART_COLOURS.grid };
const TICK = { fontSize: 11, fill: CHART_COLOURS.tick };
const AXIS_TITLE = { fontSize: 12, fill: CHART_COLOURS.text };
// Below the side-by-side layout the plot keeps the 2025 chart's height; in
// it, the plot fills the rows the map beside it uses for its controls, map
// and colour scale (see HouseholdScatterTemplate.css).
const STACKED_HEIGHT = 400;

const KEY = [
  { label: "Gains", color: CHART_COLOURS.gain },
  { label: "Losses", color: CHART_COLOURS.loss },
  { label: "No change", color: CHART_COLOURS.noChange },
];

const number = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const pounds = (value) => `${value < 0 ? "-" : ""}£${number(Math.abs(value))}`;
const roundedThousands = (value) => number(Math.max(1000, Math.round(value / 1000) * 1000));

const describe = (perDot, basisLabel) =>
  `Net income change against ${basisLabel} baseline income. Each dot stands for about ${roundedThousands(perDot)} households, grouped by their ${basisLabel} income, so a dot keeps its row across years. Green: gains; amber: losses; grey: little change.`;
const DESCRIPTION_LOADING =
  "Net income change against baseline income. Each dot stands for a group of households, grouped by their income in the first year shown. Green: gains; amber: losses; grey: little change.";

// Dots move between years and selections as the other charts' bars do:
// about 850ms, easing in and out, and not at all under reduced motion.
const TWEEN_MS = 850;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const withOpacity = (dots) => dots.map((dot) => ({ ...dot, opacity: dot.hidden ? 0 : 1 }));

/**
 * The dots as drawn. Each moves from where it was to where it now belongs,
 * found by its key (its income band and rank), so a dot that keeps its
 * group slides sideways. New dots fade in where they belong; a dot whose
 * place is off the plot fades out.
 */
function useTweenedDots(dots) {
  const [shown, setShown] = useState(() => withOpacity(dots));
  const shownRef = useRef(shown);
  useEffect(() => {
    const target = withOpacity(dots);
    const from = new Map(shownRef.current.map((dot) => [dot.key, dot]));
    const settle = (next) => {
      shownRef.current = next;
      setShown(next);
    };
    if (reducedMotion() || from.size === 0) {
      settle(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = easeInOut(t);
      settle(
        target.map((dot) => {
          const was = from.get(dot.key);
          if (!was) return { ...dot, opacity: dot.opacity * e };
          return {
            ...dot,
            change: was.change + (dot.change - was.change) * e,
            income: was.income + (dot.income - was.income) * e,
            opacity: was.opacity + (dot.opacity - was.opacity) * e,
          };
        }),
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dots]);
  return shown;
}

/**
 * The dots, drawn in the chart's SVG (so downloads carry them) on its own
 * axes. Recharts passes the axis maps; hovering a dot reports its group.
 */
function DotLayer({ xAxisMap, yAxisMap, width, dots, onHover }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const left = xAxis.x - DOT_RADIUS;
  const right = xAxis.x + xAxis.width + DOT_RADIUS;
  return (
    <g className="household-scatter-dots" onMouseLeave={() => onHover(null)}>
      {dots.map((dot) => {
        const cx = xAxis.scale(dot.change);
        const cy = yAxis.scale(dot.income);
        // Off the plot (beyond ±£5,000), as in 2025, or fading out: not drawn
        if (dot.opacity <= 0.01 || cx < left || cx > right) return null;
        return (
          <circle
            key={dot.key}
            data-dot={dot.key}
            cx={cx}
            cy={cy}
            r={DOT_RADIUS}
            fill={colourFor(dot)}
            fillOpacity={DOT_OPACITY}
            opacity={DOT_OPACITY * Math.min(1, dot.opacity)}
            strokeWidth={0}
            onMouseEnter={() => onHover(dot.hidden ? null : { dot, x: cx, y: cy, width })}
          />
        );
      })}
    </g>
  );
}

/** The tooltip, in the 2025 chart's style, describing the dot's group. */
function GroupTooltip({ hover, basisLabel, yearLabel }) {
  if (!hover) return null;
  const point = hover.dot;
  const plotWidth = hover.width ?? 0;
  const incomeTop = Math.min(
    point.incomeBand + SCATTER_BINS.income_band_width,
    SCATTER_BINS.income_max,
  );
  const kind = changeKind(point.changeBand, point.changeBandUpper);
  const change =
    kind === "zero"
      ? "no change"
      : `a change of ${pounds(point.changeBand)} to ${pounds(point.changeBandUpper)}`;
  const flip = plotWidth > 0 && hover.x > plotWidth / 2;
  return (
    <div
      className="household-scatter-tooltip"
      role="tooltip"
      style={{
        top: hover.y + 10,
        left: flip ? undefined : hover.x + 12,
        right: flip ? plotWidth - hover.x + 12 : undefined,
      }}
    >
      <p>
        In {yearLabel}, about <strong>{number(point.households)} households</strong> with{" "}
        {basisLabel} income{" "}
        <strong>
          {pounds(point.incomeBand)}–{pounds(incomeTop)}
        </strong>{" "}
        had <strong style={{ color: colourFor(point) }}>{change}</strong>.
      </p>
    </div>
  );
}

/**
 * Households by baseline net income and the change in it, drawn as the
 * 2025 dashboard drew its 500 sampled households: change on the x axis
 * (fixed ±£5,000, ticks every £2,500), baseline household net income on
 * the y axis (£0 to £150,000), uniform dots coloured by gain, loss or no
 * change, and changes beyond ±£5,000 off the plot.
 *
 * The dots come from the binned cells in household_scatter_binned.csv
 * (£5,000 income bands by change bands). Every year's households are
 * banded by their baseline income in the basis year (2027-28), so a band
 * is the same households in every year. Each band gets its dots once, by
 * its households in the basis year, and its k-th dot stands at the band's
 * k-th weighted quantile of change in the year shown (panelDots): when the
 * year changes, a dot keeps its row and its rank, and slides sideways. No
 * survey household is shown on its own (#30): a dot's tooltip gives its
 * group.
 *
 * Cells are published per reform: one measure shows its own, every measure
 * the package's, and any other selection a notice.
 */
function HouseholdScatter({ selectedPolicies, policies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const data = useHouseholdScatterData();
  const { combinedId } = useMeasureCatalogue();
  const view = useMemo(
    () => scatterView({
      data,
      selectedIds: selectedPolicies,
      policyIds: (policies ?? []).filter((policy) => policy.displayable !== false).map((policy) => policy.id),
      year: selectedYear,
      packageId: combinedId,
    }),
    [data, selectedPolicies, policies, selectedYear, combinedId],
  );
  const yearLabel = fiscalYearLabel(selectedYear);
  const chartTitle = `${CHART_TITLE}, ${yearLabel}`;
  const ready = view.kind === "points";
  const basisLabel = ready ? fiscalYearLabel(view.basisYear) : null;
  const dots = useMemo(
    () => (ready ? panelDots(view.basisPoints, view.points) : []),
    [ready, view],
  );
  const shown = useTweenedDots(dots);
  const description = ready
    ? describe(householdsPerDot(view.basisPoints), basisLabel)
    : DESCRIPTION_LOADING;

  // A hovered dot's group belongs to the year and selection it was
  // hovered in
  const hover = hovered && hovered.dots === dots ? hovered : null;
  const onHover = (next) => setHovered(next && { ...next, dots });

  const exportName = `household-income-impacts-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description,
    legendItems: KEY.map((item) => ({ ...item, type: "rect" })),
    logo: CHART_LOGO,
    // No Recharts legend: the whole SVG is the plot, so crop nothing
    reservedLegendHeight: 0,
  };
  const download = ready
    ? {
        chartRef,
        name: exportName,
        exportOptions,
        csv: () =>
          scatterCsv(view.points, { title: chartTitle, basisYear: view.basisYear }),
      }
    : null;
  const incomeTitle = basisLabel
    ? `Household net income, ${basisLabel} (£k)`
    : "Household net income (£k)";

  return (
    <div className="household-scatter-template">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={chartTitle}
          disabledReason={ready ? undefined : "Available when results are published"}
        />
      </div>

      {/* The plot takes the rows the map beside it uses for its controls,
          map and colour scale, so the two cards line up and fill alike */}
      <div className="chart-plot household-scatter-template-plot">
        <div className="household-scatter-template-canvas" ref={chartRef}>
          <ResponsiveContainer width="100%" height="100%" minHeight={STACKED_HEIGHT / 2}>
            <ScatterChart margin={{ top: 6, right: narrow ? 12 : 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis
                type="number"
                dataKey="change"
                name="Income change"
                domain={CHANGE_AXIS_DOMAIN}
                allowDataOverflow
                ticks={CHANGE_TICKS}
                interval={0}
                tickFormatter={thousands}
                tick={TICK}
                height={44}
                label={{
                  value: "Net income change (£k)",
                  position: "insideBottom",
                  offset: 4,
                  style: AXIS_TITLE,
                }}
              />
              <YAxis
                type="number"
                dataKey="income"
                name="Baseline income"
                domain={INCOME_AXIS_DOMAIN}
                allowDataOverflow
                ticks={INCOME_TICKS}
                interval={0}
                tickFormatter={thousands}
                tick={TICK}
                width={narrow ? 30 + Y_TITLE_GUTTER : 44 + Y_TITLE_GUTTER}
              />
              <ReferenceLine x={0} stroke={CHART_COLOURS.tick} strokeWidth={2} />
              <Customized component={<DotLayer dots={shown} onHover={onHover} />} />
              <Customized component={<ChartUnitLabel text={incomeTitle} />} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        {ready && (
          <GroupTooltip
            hover={hover}
            basisLabel={basisLabel}
            yearLabel={yearLabel}
          />
        )}
        {!ready && (
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

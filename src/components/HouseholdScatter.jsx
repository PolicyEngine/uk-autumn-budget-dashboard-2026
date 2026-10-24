import { useRef } from "react";
import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
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
  scatterCsv,
  scatterDots,
  scatterView,
} from "../utils/householdScatter";
import { useNarrowViewport, Y_TITLE_GUTTER } from "../utils/chartTheme";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { colourFor } from "./publication/BinnedHouseholdScatter";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./HouseholdScatterTemplate.css";

// The 2025 dashboard's household scatter (HouseholdChart, Autumn Budget
// 2025), drawn from the binned cells: same axes, ticks, grid, zero line,
// dot size and colours. Its dots were sampled households; these are not.
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
const GRID = { strokeDasharray: "3 3", stroke: "#e0e0e0" };
const TICK = { fontSize: 11, fill: "#666" };
const AXIS_TITLE = { fontSize: 12, fill: "#374151" };

const KEY = [
  { label: "Gains", color: "#319795" },
  { label: "Losses", color: "#D97706" },
  { label: "No change", color: "#9CA3AF" },
];

const number = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const pounds = (value) => `${value < 0 ? "-" : ""}£${number(Math.abs(value))}`;
const roundedThousands = (value) => number(Math.max(1000, Math.round(value / 1000) * 1000));

const describe = (perDot) =>
  `This chart plots net income change against baseline income. Each of about 500 dots stands for about ${roundedThousands(perDot)} households, placed at random within a group of households with similar incomes and changes. Green dots indicate gains, amber shows losses, and grey shows minimal change.`;
const DESCRIPTION_LOADING =
  "This chart plots net income change against baseline income. Each of about 500 dots stands for a group of households with similar incomes and changes. Green dots indicate gains, amber shows losses, and grey shows minimal change.";

/** The tooltip, in the 2025 chart's style, describing the dot's group. */
function GroupTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const incomeTop = Math.min(
    point.incomeBand + SCATTER_BINS.income_band_width,
    SCATTER_BINS.income_max,
  );
  const kind = changeKind(point.changeBand, point.changeBandUpper);
  const change =
    kind === "zero"
      ? "no change"
      : `a change of ${pounds(point.changeBand)} to ${pounds(point.changeBandUpper)}`;
  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "10px",
        border: "1px solid #ccc",
        borderRadius: "4px",
        fontSize: "12px",
        maxWidth: "280px",
        color: "#374151",
      }}
    >
      <p style={{ margin: "2px 0" }}>
        About <strong>{number(point.households)} households</strong> with income{" "}
        <strong>
          {pounds(point.incomeBand)}–{pounds(incomeTop)}
        </strong>{" "}
        and{" "}
        <strong style={{ color: colourFor(point) }}>{change}</strong>
      </p>
    </div>
  );
}

/**
 * Households by baseline net income and the change in it, drawn as the
 * 2025 dashboard drew its 500 sampled households: change on the x axis
 * (fixed ±£5,000, ticks every £2,500), baseline household net income on
 * the y axis (£0 to £150,000), a 500px plot, uniform dots coloured by gain,
 * loss or no change, and changes beyond ±£5,000 off the plot.
 *
 * The dots come from the binned cells in household_scatter_binned.csv
 * (£5,000 income bands by change bands): about 500 in all, shared out by
 * each cell's weighted households and placed at random (deterministically)
 * within the cell, so the cloud has the 2025 sample's density. No survey
 * household is shown on its own (#30): a dot's tooltip gives its group.
 *
 * Cells are published per reform: one measure shows its own, every measure
 * the package's, and any other selection a notice.
 */
function HouseholdScatter({ selectedPolicies, policies, selectedYear = 2029 }) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const data = useHouseholdScatterData();
  const view = scatterView({
    data,
    selectedIds: selectedPolicies,
    policyIds: (policies ?? []).map((policy) => policy.id),
    year: selectedYear,
  });
  const yearLabel = fiscalYearLabel(selectedYear);
  const chartTitle = `${CHART_TITLE}, ${yearLabel}`;
  const points = view.kind === "points" ? view.points : [];
  const dots = scatterDots(points).map((dot) => ({ ...dot, fill: colourFor(dot) }));
  const description =
    view.kind === "points" ? describe(householdsPerDot(points)) : DESCRIPTION_LOADING;

  const exportName = `household-income-impacts-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description,
    legendItems: KEY.map((item) => ({ ...item, type: "rect" })),
    logo: CHART_LOGO,
    // No Recharts legend: the whole SVG is the plot, so crop nothing
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
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={chartTitle}
          disabledReason={
            view.kind === "points" ? undefined : "Available when results are published"
          }
        />
      </div>

      {/* The row the map beside it uses for its controls: empty here, as
          the 2025 chart had no legend (the description names the colours) */}
      <div className="chart-controls" />

      <div className="chart-plot household-scatter-template-plot" ref={chartRef}>
        <ResponsiveContainer width="100%" height={500}>
          <ScatterChart
            margin={{ top: 20, right: narrow ? 12 : 30, left: 0, bottom: 30 }}
          >
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
              height={60}
              label={{
                value: "Net income change (£k)",
                position: "insideBottom",
                offset: 10,
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
              width={narrow ? 30 + Y_TITLE_GUTTER : 60 + Y_TITLE_GUTTER}
            />
            {view.kind === "points" && (
              <Tooltip
                content={<GroupTooltip />}
                cursor={{ strokeDasharray: "3 3" }}
                isAnimationActive={false}
              />
            )}
            <ReferenceLine x={0} stroke="#666" strokeWidth={2} />
            {view.kind === "points" && (
              <Scatter
                data={dots}
                isAnimationActive={false}
                shape={({ cx, cy, payload }) => (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={DOT_RADIUS}
                    fill={payload.fill}
                    fillOpacity={DOT_OPACITY}
                    opacity={DOT_OPACITY}
                    strokeWidth={0}
                  />
                )}
              />
            )}
            <Customized component={<ChartUnitLabel text="Household net income (£k)" />} />
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

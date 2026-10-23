import { useRef } from "react";
import {
  CartesianGrid,
  Cell,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  changeBandLabel,
  incomeBandLabel,
  scatterCsv,
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
import { buildChartSvg, exportChartAsSvg } from "../utils/exportChartAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { colourFor } from "./publication/BinnedHouseholdScatter";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./HouseholdScatterTemplate.css";

const CHART_TITLE = "Household income impacts";
const CHART_DESCRIPTION =
  "Each bubble is a group of households with similar baseline incomes and income changes; its size shows how many.";

const pounds = (value) =>
  `${value < 0 ? "-" : ""}£${new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.abs(value))}`;
const thousands = (value) => (value === 0 ? "£0" : `£${value / 1000}k`);
const households = (value) =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)} households`;

const KEY = [
  { label: "Gain", color: "#319795" },
  { label: "Loss", color: "#D97706" },
  { label: "Little change", color: "#9CA3AF" },
];

function CellTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{households(point.households)}</p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: "transparent" }} />
        <span className="chart-tooltip-name">Baseline income</span>
        <span className="chart-tooltip-value">{incomeBandLabel(point.incomeBand)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: colourFor(point) }} />
        <span className="chart-tooltip-name">Change a year</span>
        <span className="chart-tooltip-value">{changeBandLabel(point.changeBand)}</span>
      </div>
    </div>
  );
}

/**
 * Households by baseline net income and the change in it, from the binned
 * cells in household_scatter_binned.csv: each bubble is one cell of £5,000
 * income band by £100 change band, its area the weighted number of
 * households in it. No survey household is shown on its own (#30).
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
  const incomeTicks = [];
  for (
    let value = SCATTER_BINS.income_min;
    value <= SCATTER_BINS.income_max;
    value += narrow ? 50000 : 25000
  ) {
    incomeTicks.push(value);
  }
  const points =
    view.kind === "points"
      ? view.points.map((point) => ({ ...point, fill: colourFor(point) }))
      : [];

  const exportName = `household-income-impacts-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: CHART_DESCRIPTION,
    legendItems: KEY.map((item) => ({ ...item, type: "rect" })),
    logo: CHART_LOGO,
  };
  const downloads =
    view.kind === "points"
      ? {
          csv: () =>
            downloadFile(
              scatterCsv(view.points, { title: chartTitle }),
              `${exportName}.csv`,
              "text/csv;charset=utf-8",
            ),
          png: async () =>
            downloadSvgAsPng(await buildChartSvg(chartRef, exportOptions), exportName),
          svg: () => exportChartAsSvg(chartRef, exportName, exportOptions),
        }
      : {};

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
          formats={downloads}
          chartTitle={chartTitle}
          disabledReason={
            view.kind === "points" ? undefined : "Available when results are published"
          }
        />
      </div>

      {/* Rows shared with the map beside it */}
      <div className="chart-controls" aria-hidden="true" />

      <div className="chart-plot household-scatter-template-plot" ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 340 : 380}>
          <ScatterChart margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
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
              dataKey="change"
              domain={[SCATTER_BINS.change_min, SCATTER_BINS.change_max]}
              tickFormatter={pounds}
              tick={TICK_STYLE}
              axisLine={false}
              tickLine={false}
              width={axisWidth([SCATTER_BINS.change_min, SCATTER_BINS.change_max], pounds)}
            />
            <ZAxis type="number" dataKey="households" range={[12, narrow ? 260 : 420]} />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            {view.kind === "points" && (
              <Tooltip {...TOOLTIP_PROPS} cursor={false} content={<CellTooltip />} />
            )}
            {view.kind === "points" && (
              <Scatter data={points} shape="circle" fillOpacity={0.75} isAnimationActive={false}>
                {points.map((point) => (
                  <Cell key={`${point.incomeBand}:${point.changeBand}`} fill={point.fill} />
                ))}
              </Scatter>
            )}
            <Customized component={<ChartUnitLabel text="Change in household net income (£ a year)" />} />
          </ScatterChart>
        </ResponsiveContainer>
        {view.kind !== "points" && (
          <div className="household-scatter-template-note" role="status">
            <p>{view.kind === "loading" ? "Loading household results…" : view.reason}</p>
            {view.detail && <p className="household-scatter-template-detail">{view.detail}</p>}
          </div>
        )}
      </div>

      <div className="chart-legend">
        <div className="scatter-key" aria-hidden="true">
          {KEY.map((item) => (
            <span key={item.label} className="scatter-key-item">
              <span className="scatter-key-dot" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
          <span className="scatter-key-item">
            <span className="scatter-key-size" />
            Bubble size: households
          </span>
        </div>
        <p className="household-scatter-floor">
          Groups with fewer than {SCATTER_BINS.min_households} surveyed households are
          not shown; the outer bands include everything beyond them.
        </p>
      </div>

      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}

export default HouseholdScatter;

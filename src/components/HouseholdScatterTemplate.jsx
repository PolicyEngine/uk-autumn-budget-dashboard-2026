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
import { SCATTER_BINS } from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
} from "../utils/chartTheme";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./HouseholdScatterTemplate.css";

const CHART_TITLE = "Household income impacts";

const pounds = (value) =>
  `${value < 0 ? "-" : ""}£${new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.abs(value))}`;
const thousands = (value) => (value === 0 ? "£0" : `£${value / 1000}k`);

/**
 * The household scatter's card, laid out in full before its results are
 * published: the real axes (baseline household net income against the
 * change in it, on the binned scale the publication contract sets), the
 * gridlines and the logo, with an empty plot and a note. No points are
 * drawn.
 *
 * TODO(publication): when the manifest publishes household_scatter_binned
 * for the selection, render BinnedHouseholdScatter
 * (src/components/publication/BinnedHouseholdScatter.jsx) with
 * `scatterSeries` from src/utils/publication/select.js in this card's plot
 * row. It shows binned cells, never single survey households (the
 * per-household scatter was withdrawn for disclosure; see App.jsx).
 */
function HouseholdScatterTemplate({ selectedYear = 2029 }) {
  const narrow = useNarrowViewport();
  const chartTitle = `${CHART_TITLE}, ${fiscalYearLabel(selectedYear)}`;
  const incomeTicks = [];
  for (
    let value = SCATTER_BINS.income_min;
    value <= SCATTER_BINS.income_max;
    value += narrow ? 50000 : 25000
  ) {
    incomeTicks.push(value);
  }

  return (
    <div className="household-scatter-template">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            Each bubble is a group of households with similar baseline incomes
            and income changes; its size shows how many.
          </p>
        </div>
        <ChartDownloadMenu
          formats={{}}
          chartTitle={chartTitle}
          disabledReason="Available when results are published"
        />
      </div>

      {/* Rows shared with the map beside it */}
      <div className="chart-controls" aria-hidden="true" />

      <div className="chart-plot household-scatter-template-plot">
        <ResponsiveContainer width="100%" height={narrow ? 340 : 380}>
          <ScatterChart
            margin={{ top: 24, right: 16, left: 0, bottom: 0 }}
          >
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
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            <Customized component={<ChartUnitLabel text="Change in household net income (£ a year)" />} />
          </ScatterChart>
        </ResponsiveContainer>
        <p className="household-scatter-template-note" role="status">
          Household results are not yet published.
        </p>
      </div>

      <div className="chart-legend">
        <div className="scatter-key" aria-hidden="true">
          <span className="scatter-key-item">
            <span className="scatter-key-dot" style={{ background: "#319795" }} />
            Gain
          </span>
          <span className="scatter-key-item">
            <span className="scatter-key-dot" style={{ background: "#D97706" }} />
            Loss
          </span>
          <span className="scatter-key-item">
            <span className="scatter-key-dot" style={{ background: "#9CA3AF" }} />
            Little change
          </span>
          <span className="scatter-key-item">
            <span className="scatter-key-size" />
            Bubble size: households
          </span>
        </div>
      </div>

      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}

export default HouseholdScatterTemplate;

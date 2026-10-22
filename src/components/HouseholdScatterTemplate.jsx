import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { PolicyEngineLogo } from "../utils/chartLogo";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
} from "../utils/chartTheme";
import ChartDownloadMenu from "./ChartDownloadMenu";
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
          <h2>
            <NoBreakYear text={chartTitle} />
          </h2>
          <p className="chart-description">
            Each bubble is a group of households with similar baseline incomes
            and income changes; its size shows how many.
          </p>
        </div>
        <ChartDownloadMenu
          formats={{}}
          ariaLabel="Download household income impacts"
          disabledReason="Available when results are published"
        />
      </div>

      <div className="chart-body household-scatter-template-plot">
        <ResponsiveContainer width="100%" height={narrow ? 360 : 440}>
          <ScatterChart
            margin={
              narrow
                ? { top: 12, right: 16, left: 0, bottom: 30 }
                : { top: 16, right: 24, left: 8, bottom: 30 }
            }
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
              width={narrow ? 56 : 76}
              label={
                narrow
                  ? undefined
                  : {
                      value: "Change in household net income (£ a year)",
                      angle: -90,
                      position: "insideLeft",
                      dx: 6,
                      style: AXIS_TITLE_STYLE,
                    }
              }
            />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            <Customized component={PolicyEngineLogo} />
          </ScatterChart>
        </ResponsiveContainer>
        <p className="household-scatter-template-note" role="status">
          Household results are not yet published.
        </p>
      </div>
    </div>
  );
}

export default HouseholdScatterTemplate;

import { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO, PolicyEngineLogo } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import TitleIcon from "./TitleIcon";
import {
  AXIS_LINE,
  CHART_COLOURS,
  GRID_PROPS,
  HOVER_CURSOR,
  TICK_STYLE,
  axisWidth,
  chartMargin,
  fiscalYearTick,
  shortFiscalYearTick,
  useNarrowViewport,
  zeroBasedAxis,
} from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";
import { wholeSelectionRun } from "../utils/ageImpact";
import { chartMotion } from "../utils/chartMotion";

/**
 * The summary statistics from metrics.csv that Population impact charts,
 * each by year. Neither adds up across measures, so each is read from one
 * run: the policy's own when one is selected, the combined run when all are.
 * A fall is good for households either way, so it is drawn in the gain
 * colour.
 */
export const SUMMARY_METRICS = {
  poverty: {
    key: "poverty_change_pp",
    title: "Change in the poverty rate",
    description:
      "Change in the share of people in absolute poverty before housing costs, each year, in percentage points.",
    unit: "Change (pp)",
    icon: "users",
    decimals: 2,
    format: (value) => `${Math.abs(value).toFixed(2)}pp`,
    csvUnits: "percentage points; people in households below the absolute poverty line, before housing costs",
    file: "poverty-rate-change",
  },
  inequality: {
    key: "gini_change",
    title: "Change in income inequality",
    description:
      "Relative change in the Gini coefficient of equivalised household net income, each year.",
    unit: "Change in Gini (%)",
    icon: "percent",
    // gini_change is a fraction; shown as a percentage
    scale: 100,
    decimals: 2,
    format: (value) => `${Math.abs(value).toFixed(2)}%`,
    csvUnits: "% change in the Gini coefficient (equivalised household net income)",
    file: "gini-change",
  },
};

/**
 * One point per shown year: the metric for the whole selection's run, or
 * null where that run has no row for the year (not yet published).
 *
 * @param {Array<Object>} rows - metrics.csv rows (strings, as parsed)
 * @param {string|null} run - The run to read (wholeSelectionRun)
 * @param {{key: string, scale?: number}} metric
 */
export function metricByYear(rows, run, metric) {
  if (!run) return [];
  return DISPLAY_YEARS.map((year) => {
    const row = (rows ?? []).find(
      (candidate) => candidate.reform_id === run && Number(candidate.year) === year,
    );
    const raw = row ? Number(row[metric.key]) : NaN;
    return { year, value: Number.isFinite(raw) ? raw * (metric.scale ?? 1) : null };
  });
}

/**
 * A summary statistic of the selected policies by year (SUMMARY_METRICS),
 * with the year chosen in the band drawn darker. With a selection that has
 * no single run (two or more policies, not all), it says to choose one
 * policy or all, as Young people's shares do.
 */
function SummaryMetricChart({ metric, rows, policies, selectedPolicies, selectedYear }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
  const run = wholeSelectionRun(policies, selectedPolicies);
  const data = metricByYear(rows, run, metric);
  const shown = data.filter((point) => point.value !== null);
  const { domain, ticks } = zeroBasedAxis(shown.map((point) => point.value));
  // As many decimals as the tick step needs (0.05 steps: two)
  const step = ticks.length > 1 ? Math.round(Math.abs(ticks[1] - ticks[0]) * 1e6) / 1e6 : 1;
  const decimals = (String(step).split(".")[1] ?? "").length;
  const tick = (value) => (value === 0 ? "0" : value.toFixed(decimals));
  const height = narrow ? 300 : 340;

  const download = {
    chartRef,
    name: metric.file,
    exportOptions: { title: metric.title, description: metric.description, logo: CHART_LOGO },
    csv: () =>
      buildChartCsv({
        title: metric.title,
        units: metric.csvUnits,
        columns: [
          { key: "year", label: "Fiscal year" },
          { key: "value", label: metric.unit, decimals: 4 },
        ],
        rows: shown.map((point) => ({ ...point, year: fiscalYearTick(point.year) })),
      }),
    published: shown.length > 0,
  };

  return (
    <div className="summary-metric-chart">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name={metric.icon} />
            <span className="title-text">{metric.title}</span>
          </h3>
          <p className="chart-description">{metric.description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={metric.title} />
      </div>
      <div ref={chartRef}>
        {!run ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>Choose one policy or all policies</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              // Room under the year ticks for the logo
              margin={{ ...chartMargin(narrow, { top: 16 }), bottom: CHART_LOGO.height + CHART_LOGO.padding + 8 }}
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="year"
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                width={axisWidth(ticks, tick)}
                axisLine={false}
                tickLine={false}
                tick={TICK_STYLE}
                tickFormatter={tick}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={
                  <ChartTooltip
                    format={metric.format}
                    labelFormat={fiscalYearTick}
                    showPlus
                    showZero
                    single={{ key: "value", label: metric.title, color: CHART_COLOURS.gain }}
                  />
                }
              />
              <Bar dataKey="value" name={metric.title} {...chartMotion()}>
                {data.map((point) => {
                  const colour = point.value > 0 ? CHART_COLOURS.loss : CHART_COLOURS.gain;
                  return (
                    <Cell
                      key={point.year}
                      fill={colour}
                      fillOpacity={point.year === selectedYear ? 1 : 0.45}
                    />
                  );
                })}
              </Bar>
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
              <Customized component={<ChartUnitLabel text={metric.unit} />} />
              <Customized component={PolicyEngineLogo} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default SummaryMetricChart;

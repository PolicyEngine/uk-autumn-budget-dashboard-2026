import { useRef, useState } from "react";
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
import PillSelect from "./PillSelect";
import "./SummaryMetricChart.css";
// The in-card pill styles (.ls-controls), shared with the current-law cards
import "./livingStandards/LivingStandards.css";
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
  divergingAxis,
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
    noChange: "The selected policies do not change the poverty rate in any year shown.",
    choices: "poverty",
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
    noChange: "The selected policies do not change income inequality in any year shown.",
    choices: "inequality",
  },
};

/**
 * The poverty measures metrics.csv carries beside the headline (absolute,
 * before housing costs, for everyone): the choices are the pill groups
 * above the chart, and the address keeps them (?poverty=relative-ahc-children).
 */
export const POVERTY_CHOICES = [
  {
    name: "basis",
    label: "Poverty line",
    options: [
      { value: "absolute", label: "Absolute" },
      { value: "relative", label: "Relative" },
    ],
  },
  {
    name: "housing",
    label: "Housing costs",
    options: [
      { value: "bhc", label: "Before housing costs", badge: "Before" },
      { value: "ahc", label: "After housing costs", badge: "After" },
    ],
  },
  {
    name: "group",
    label: "People",
    options: [
      { value: "all", label: "All people" },
      { value: "children", label: "Children" },
    ],
  },
];

const POVERTY_DEFAULT = { basis: "absolute", housing: "bhc", group: "all" };

const POVERTY_LINES = {
  absolute: "the absolute poverty line (60% of 2024-25 median income, held constant in real terms)",
  // policyengine-uk's in_relative_poverty_*: 60% of the median in the same
  // simulation, so under the policies the line is their own median's
  relative:
    "relative poverty (below 60% of median income in the same year; the line moves with the policies' effect on the median)",
};

const HOUSING = { bhc: "before housing costs", ahc: "after housing costs" };

/** The poverty chart's metric for one choice of line, housing costs and people. */
export function povertyMetric({ basis, housing, group }) {
  const children = group === "children";
  const measure = `${basis === "absolute" ? "abs" : "rel"}_${housing}`;
  const headline = basis === "absolute" && housing === "bhc" && !children;
  const people = children ? "children" : "people";
  return {
    ...SUMMARY_METRICS.poverty,
    // The headline column is the same figure, and older files have only it
    key: headline ? SUMMARY_METRICS.poverty.key : `${children ? "child_" : ""}poverty_${measure}_change_pp`,
    title: children ? "Change in the child poverty rate" : SUMMARY_METRICS.poverty.title,
    description:
      `Change in the share of ${people} in ${basis === "absolute" ? "absolute poverty" : "relative poverty"} ` +
      `${HOUSING[housing]}, each year, in percentage points.` +
      (basis === "relative" ? " The line is 60% of median income in the same year, so it moves with the policies' effect on the median." : "") +
      (children ? " Children are dependent children as DWP counts them: under 16, or 16 to 19 in full-time non-advanced education." : ""),
    csvUnits: `percentage points; ${people} in households below ${POVERTY_LINES[basis]}, ${HOUSING[housing]}`,
    file: `${children ? "child-" : ""}poverty-rate-change-${basis}-${housing}`,
    noChange: `The selected policies do not change the ${children ? "child " : ""}poverty rate in any year shown.`,
  };
}

/** The inequality chart's measures (?inequality=top-10). */
export const INEQUALITY_METRICS = {
  gini: { ...SUMMARY_METRICS.inequality, label: "Gini" },
  "top-10": {
    ...SUMMARY_METRICS.inequality,
    label: "Top 10% share",
    title: "Change in the top 10% income share",
    key: "top_10_share_change_pp",
    description:
      "Change in the share of equivalised household net income received by the 10% of people with the highest incomes, each year, in percentage points.",
    unit: "Change (pp)",
    scale: 1,
    decimals: 3,
    format: (value) => `${Math.abs(value).toFixed(3)}pp`,
    csvUnits: "percentage points; share of equivalised household net income received by the top 10% of people",
    file: "top-10-share-change",
  },
  "top-1": {
    ...SUMMARY_METRICS.inequality,
    label: "Top 1% share",
    title: "Change in the top 1% income share",
    key: "top_1_share_change_pp",
    description:
      "Change in the share of equivalised household net income received by the 1% of people with the highest incomes, each year, in percentage points.",
    unit: "Change (pp)",
    scale: 1,
    decimals: 3,
    format: (value) => `${Math.abs(value).toFixed(3)}pp`,
    csvUnits: "percentage points; share of equivalised household net income received by the top 1% of people",
    file: "top-1-share-change",
  },
  "90-10": {
    ...SUMMARY_METRICS.inequality,
    label: "90/10 ratio",
    title: "Change in the 90/10 income ratio",
    key: "p90_p10_change",
    description:
      "Relative change in the 90/10 ratio, the equivalised household net income of the person at the 90th percentile over that at the 10th, each year.",
    unit: "Change in 90/10 ratio (%)",
    csvUnits: "% change in the 90/10 ratio (equivalised household net income)",
    file: "90-10-ratio-change",
  },
};

const PARAM = { poverty: "poverty", inequality: "inequality" };

function readParam(name) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Put a choice in the address, or take it out when it is the default. */
function writeParam(name, value) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value);
  else params.delete(name);
  const search = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
}

/** A poverty choice from ?poverty=, the default where a part is unknown. */
export function parsePovertyChoice(text) {
  const parts = (text ?? "").split("-");
  const choice = { ...POVERTY_DEFAULT };
  POVERTY_CHOICES.forEach((group, index) => {
    if (group.options.some((option) => option.value === parts[index])) choice[group.name] = parts[index];
  });
  return choice;
}

/** Whether metrics.csv has a column (older files have only the headline ones). */
export function hasColumn(rows, key) {
  return (rows ?? []).some((row) => row[key] !== undefined && row[key] !== "");
}

/**
 * The chosen measure for a chart with choices (poverty, inequality), and the
 * pill groups that choose it; none when the file predates the measures.
 */
function useMeasureChoice(metric, rows) {
  const family = metric.choices;
  const [poverty, setPoverty] = useState(() => parsePovertyChoice(readParam(PARAM.poverty)));
  const [inequality, setInequality] = useState(() => {
    const value = readParam(PARAM.inequality);
    return INEQUALITY_METRICS[value] ? value : "gini";
  });

  if (family === "poverty" && hasColumn(rows, "child_poverty_rel_ahc_change_pp")) {
    const choose = (name) => (value) => {
      const next = { ...poverty, [name]: value };
      setPoverty(next);
      const text = POVERTY_CHOICES.map((group) => next[group.name]).join("-");
      writeParam(PARAM.poverty, text === "absolute-bhc-all" ? null : text);
    };
    return {
      metric: povertyMetric(poverty),
      controls: POVERTY_CHOICES.map((group) => ({
        label: group.label,
        value: poverty[group.name],
        onChange: choose(group.name),
        options: group.options,
      })),
    };
  }
  if (family === "inequality" && hasColumn(rows, "p90_p10_change")) {
    return {
      metric: INEQUALITY_METRICS[inequality],
      controls: [
        {
          label: "Inequality measure",
          value: inequality,
          onChange: (value) => {
            setInequality(value);
            writeParam(PARAM.inequality, value === "gini" ? null : value);
          },
          options: Object.entries(INEQUALITY_METRICS).map(([value, measure]) => ({ value, label: measure.label })),
        },
      ],
    };
  }
  // A file without the measures: the headline column, no choice
  return { metric, controls: [] };
}

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
function SummaryMetricChart({ metric: family, rows, policies, selectedPolicies, selectedYear }) {
  const chartRef = useRef(null);
  const { metric, controls } = useMeasureChoice(family, rows);
  const narrow = useNarrowViewport();
  const run = wholeSelectionRun(policies, selectedPolicies);
  const data = metricByYear(rows, run, metric);
  const shown = data.filter((point) => point.value !== null);
  // Every shown value reads as zero at the tooltip's precision (a measure
  // that moves no one across the poverty line): a note, not a plot of zeros
  const allZero =
    shown.length > 0 && shown.every((point) => Number(Math.abs(point.value).toFixed(metric.decimals)) === 0);
  // Symmetric about zero when the change goes both ways (divergingAxis)
  const { domain, ticks } = divergingAxis(shown.map((point) => point.value));
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
      {/* The measure, as the cards beside it choose theirs: one pill per
          choice ("Inequality measure: Gini ▾") under the description, in
          the card's controls row */}
      {controls.length > 0 && (
        <div className="chart-controls ls-controls summary-metric-choices">
          {controls.map((control) => (
            <PillSelect
              key={control.label}
              variant="light"
              prefix={control.label}
              name={control.label}
              options={control.options}
              value={control.value}
              onChange={control.onChange}
            />
          ))}
        </div>
      )}
      <div ref={chartRef} className={controls.length > 0 ? "summary-metric-plot" : undefined}>
        {!run ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>Choose one policy or all policies</p>
          </div>
        ) : shown.length === 0 ? (
          // On Budget day a run (the combined one last) can be named
          // before its rows are published: say so, never draw zeros
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>Not yet published for this selection</p>
          </div>
        ) : allZero ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{metric.noChange}</p>
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
                    grouped={false}
                  />
                }
              />
              <Bar
                dataKey="value"
                name={metric.title}
                fill={CHART_COLOURS.gain}
                {...chartMotion()}
              >
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

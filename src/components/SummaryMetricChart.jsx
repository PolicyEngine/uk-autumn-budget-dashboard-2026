import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Customized, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "./ViewportTooltip";
import { CHART_LOGO, PolicyEngineLogo } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import TitleIcon from "./TitleIcon";
import ControlBar from "./ControlBar";
import SelectedYearShade from "./SelectedYearShade";
import "./SummaryMetricChart.css";
// The in-card pill styles (.ls-controls), shared with the current-law cards
import "./livingStandards/LivingStandards.css";
import {
  barShape,
  AXIS_LINE,
  CHART_COLOURS,
  GRID_PROPS,
  HOVER_CURSOR,
  TICK_STYLE,
  UNSELECTED_OPACITY,
  axisWidth,
  chartMargin,
  fiscalYearTick,
  fittedAxis,
  shortFiscalYearTick,
  tickDecimals,
  useNarrowViewport,
} from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";
import { wholeSelectionRun } from "../utils/ageImpact";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { chartMotion } from "../utils/chartMotion";
import { formatPp, peopleInPovertyText, roundPeople } from "../utils/povertyPeople";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { shortNameOf } from "../utils/policyDetails";
import MeasureEffectsView, { EFFECT_VIEWS, yearEffects } from "./MeasureEffectsView";

// The dashboard's bar style: each bar rounds its end away from zero (chartTheme)
const VALUE_BAR_SHAPE = barShape(["value"]);

/**
 * The summary statistics from metrics.csv that Population impact charts,
 * each by year. Neither adds up across measures, so each is read from one
 * run: the policy's own when one is selected, the combined run when all are.
 * A fall in poverty is drawn in the gain colour and a rise in the loss
 * colour; the inequality measures (Gini, top shares, ratios) are drawn in
 * one neutral colour (INEQUALITY_FILL), never gain or loss, since a change
 * in inequality is not a gain or a loss for any one household.
 */
export const SUMMARY_METRICS = {
  poverty: {
    key: "poverty_change_pp",
    title: "Change in the poverty rate",
    description:
      "Change in the share of people in absolute poverty before housing costs, each year, in percentage points.",
    unit: "Change (pp)",
    csvLabel: "Change in poverty rate (percentage points)",
    // The headline measure's people and line, for the sentence in people
    group: "all",
    line: "absolute poverty before housing costs",
    icon: "users",
    // One formatter for every poverty card (formatPp): 3 decimals under 0.1pp
    decimals: 3,
    format: (value) => formatPp(Math.abs(value)).replace(/^[+−]/, ""),
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
    format: (value) => `${sigFigs(Math.abs(value), 3)}%`,
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

// The inequality measures' bars: the dashboard's dark teal-slate
// (--c-highlight), neither the gain teal nor the loss amber
export const INEQUALITY_FILL = CHART_COLOURS.highlight;

/**
 * A size to `digits` significant digits, without trailing zeros or an
 * exponent: 0.00832 → "0.0083", 0.16 → "0.16", 1.234 → "1.2" (2 digits).
 */
export function sigFigs(size, digits = 2) {
  if (!Number.isFinite(size) || size === 0) return "0";
  return Number(size.toPrecision(digits)).toLocaleString("en-GB", { maximumSignificantDigits: digits, useGrouping: false });
}

/** Whether a metric is in percentage points (a rate or share), not per cent. */
const isPp = (metric) => /\(pp\)$/.test(metric.unit);

/**
 * A change's size in words, unsigned, in the metric's own unit, to two
 * significant digits: a rate or a share in percentage points ("0.0083
 * percentage points"), a relative change (the Gini, the 90/10 ratio) in per
 * cent ("0.16%"), never one for the other. Null when it rounds to 0.00 (a
 * change too small to name).
 */
export function plainAmount(metric, value) {
  const size = Math.abs(value);
  if (Number(size.toFixed(2)) === 0) return null;
  return isPp(metric) ? `${sigFigs(size)} percentage points` : `${sigFigs(size)}%`;
}

/**
 * The card's sentence for the selected year, plain and built from the data:
 * "In 2029-30 the selected policies lower the top 10% income share by about
 * 0.0083 percentage points." With people (poverty): "… move about 4,200
 * people out of absolute poverty before housing costs, lowering the rate by
 * about 0.012 percentage points." Almost no change when it rounds to 0.00.
 */
export function metricSentence(metric, yearText, value, count = null) {
  const amount = plainAmount(metric, value);
  const subject = subjectOf(metric);
  const start = `In ${yearText} the selected policies`;
  if (metric.line && count) {
    const move = `${start} move ${count} ${value < 0 ? "out of" : "into"} ${metric.line}`;
    return amount
      ? `${move}, ${value < 0 ? "lowering" : "raising"} the rate by about ${amount}.`
      : `${move}, almost no change in the rate.`;
  }
  if (!amount) return `${start} make almost no change to ${subject}.`;
  return `${start} ${value < 0 ? "lower" : "raise"} ${subject} by about ${amount}.`;
}

/** What the sentence names: "income inequality (the Gini coefficient)", "the poverty rate". */
const subjectOf = (metric) =>
  metric.key === "gini_change" ? "income inequality (the Gini coefficient)" : metric.title.replace(/^Change in /, "");

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
    // "Change in absolute poverty (before housing costs), pp": the card's short subtitle
    short: `Change in ${basis} ${children ? "child " : ""}poverty (${housing.toUpperCase()}), pp`,
    // What the long description adds, for About this chart
    detail:
      (basis === "relative" ? "The relative line is 60% of median income in the same year, so it moves with the policies' effect on the median. " : "") +
      (children ? "Children are dependent children as DWP counts them: under 16, or 16 to 19 in full-time non-advanced education." : ""),
    // "the share of children in relative poverty after housing costs"
    phrase: `the share of ${people} in ${basis === "absolute" ? "absolute poverty" : "relative poverty"} ${HOUSING[housing]}`,
    // "absolute poverty before housing costs", for the card's sentence
    line: `${basis} poverty ${HOUSING[housing]}`,
    unit: "Change (pp)",
    csvLabel: `Change in ${children ? "child " : ""}poverty rate (percentage points)`,
    group,
  };
}

/**
 * A value axis fitted tight to the bars: the largest bar plus 8%, rounded
 * up to a step of 1, 2, 2.5 or 5 × 10^k (two steps a side), from zero when
 * every value has one sign; fitted to each side (chartTheme.fittedAxis),
 * never forced symmetric, when they go both ways.
 */
export function tightAxis(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.some((v) => v > 0) && finite.some((v) => v < 0)) return fittedAxis(finite);
  const size = Math.max(...finite.map(Math.abs), 1e-9) * 1.08;
  const raw = size / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw - 1e-12);
  const top = Math.ceil(size / step - 1e-9) * step;
  const up = finite.some((v) => v > 0);
  const down = finite.some((v) => v < 0);
  const lo = down ? -top : 0;
  const hi = up || !down ? top : 0;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return { domain: [lo, hi], ticks };
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
    format: (value) => `${sigFigs(Math.abs(value), 3)}pp`,
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
    format: (value) => `${sigFigs(Math.abs(value), 3)}pp`,
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

// The poverty choice is one for the page: the Change in the poverty rate
// chart and Which measures move poverty share it, so choosing in one
// changes both (?poverty=)
const POVERTY_EVENT = "poverty-choice";

/** The poverty choice (line, housing costs, people), shared and kept in ?poverty=. */
export function usePovertyChoice() {
  const [poverty, setPoverty] = useState(() => parsePovertyChoice(readParam(PARAM.poverty)));
  useEffect(() => {
    const onChange = (event) => setPoverty(event.detail);
    window.addEventListener(POVERTY_EVENT, onChange);
    return () => window.removeEventListener(POVERTY_EVENT, onChange);
  }, []);
  const choose = (name) => (value) => {
    const next = { ...poverty, [name]: value };
    const text = POVERTY_CHOICES.map((group) => next[group.name]).join("-");
    writeParam(PARAM.poverty, text === "absolute-bhc-all" ? null : text);
    window.dispatchEvent(new CustomEvent(POVERTY_EVENT, { detail: next }));
  };
  const controls = POVERTY_CHOICES.map((group) => ({
    label: group.label,
    value: poverty[group.name],
    onChange: choose(group.name),
    options: group.options,
  }));
  return { poverty, controls };
}

/** Whether metrics.csv has a column (older files have only the headline ones). */
export function hasColumn(rows, key) {
  return (rows ?? []).some((row) => row[key] !== undefined && row[key] !== "");
}

/**
 * The rows that decide whether a chart offers its choices: the shown run's,
 * so a verified artifact written before the poverty and inequality measures
 * shows its headline only, even when another run carries them; every run's
 * while no run is shown or the run has no rows; with no whole-selection run,
 * a selected measure's that lacks them.
 */
export function choiceRows(rows, run, selected = []) {
  const own = run ? (rows ?? []).filter((row) => row.reform_id === run) : [];
  if (own.length) return own;
  // No whole-selection run: each selected measure's own run is drawn, so a
  // choice is offered only when every one of them carries the measures (the
  // rows of a measure without them come first, so its absence decides)
  if (!run && selected.length > 1) {
    const ofMeasure = (id) => (rows ?? []).filter((row) => row.reform_id === id);
    const lacking = selected.map(ofMeasure).find((own) => own.length && !own.some((row) => row.top_10_share_change_pp !== undefined && row.top_10_share_change_pp !== ""));
    if (lacking) return lacking;
  }
  return rows;
}

/**
 * The chosen measure for a chart with choices (poverty, inequality), and the
 * pill groups that choose it; none when the file predates the measures.
 */
function useMeasureChoice(metric, rows) {
  const family = metric.choices;
  const { poverty, controls: povertyControls } = usePovertyChoice();
  const [inequality, setInequality] = useState(() => {
    const value = readParam(PARAM.inequality);
    return INEQUALITY_METRICS[value] ? value : "gini";
  });

  if (family === "poverty" && hasColumn(rows, "child_poverty_rel_ahc_change_pp")) {
    return { metric: povertyMetric(poverty), controls: povertyControls, group: poverty.group };
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
 * A run's value of a measure in its row, or null where the row does not
 * carry it: absent (a run written before the poverty and inequality
 * measures), empty or null is never a change of 0.
 */
export function metricValue(row, key) {
  const raw = row?.[key];
  const value = raw === undefined || raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * One point per shown year: the metric for the whole selection's run, or
 * null where that run has no row for the year, or a row without the metric
 * (not yet published).
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
    const value = metricValue(row, metric.key);
    return { year, value: value === null ? null : value * (metric.scale ?? 1) };
  });
}

/**
 * A summary statistic of the selected policies by year (SUMMARY_METRICS),
 * with the year chosen in the band drawn darker. With a selection that has
 * no single run (two or more measures, and no published combined run that
 * matches), one bar per measure and year, each measure's own run: these
 * statistics are never added up across measures.
 */
function SummaryMetricChart({ metric: family, rows, policies, selectedPolicies, selectedYear, population, choiceAbove = false }) {
  const chartRef = useRef(null);
  // The whole selection's run: one measure's own, or the package's combined
  // run (the catalogue's, #104) when every displayable measure is selected
  const catalogue = useMeasureCatalogue();
  const { combinedId } = catalogue;
  const run = wholeSelectionRun(policies, selectedPolicies, combinedId);
  const { metric, controls } = useMeasureChoice(family, choiceRows(rows, run, selectedPolicies));
  // Each measure on its own: the selected year (default) or year by year
  const [effectView, setEffectView] = useState("year");
  // People behind a poverty change (pp × the population), where the
  // population is known for the year (population(year, group) in millions)
  const peopleText = (year, value) =>
    metric.group && population ? peopleInPovertyText(value, population(year, metric.group), metric.group) : null;
  const narrow = useNarrowViewport();
  // No run for the whole selection: each selected measure's own, side by side
  const byMeasure = !run && selectedPolicies.length > 1
    ? policies
        .filter((policy) => selectedPolicies.includes(policy.id) && policy.displayable !== false)
        .map((policy) => ({
          id: policy.id,
          name: shortNameOf(policy),
          fullName: policy.label ?? policy.name,
          colour: catalogue.byId?.get(policy.id)?.color ?? policy.color ?? CHART_COLOURS.noChange,
          points: metricByYear(rows, policy.id, metric),
        }))
    : null;
  const measureData = byMeasure
    ? DISPLAY_YEARS.map((year, i) => ({
        year,
        ...Object.fromEntries(byMeasure.map((m) => [m.id, m.points[i]?.value ?? null])),
      }))
    : null;
  // Every year shown, from 2027-28 (FIRST_DISPLAY_YEAR)
  const years = DISPLAY_YEARS;
  const data = byMeasure ? [] : metricByYear(rows, run, metric).filter((point) => years.includes(point.year));
  const shown = byMeasure
    ? byMeasure.flatMap((m) => m.points).filter((point) => point.value !== null)
    : data.filter((point) => point.value !== null);
  // Every shown value reads as zero at the tooltip's precision (a measure
  // that moves no one across the poverty line): a note, not a plot of zeros
  const allZero =
    shown.length > 0 && shown.every((point) => Number(Math.abs(point.value).toFixed(metric.decimals)) === 0);
  // Fitted to the data: from zero when every bar has one sign, fitted to
  // each side when they go both ways, with round ticks (tightAxis)
  const { domain, ticks } = tightAxis(shown.map((point) => point.value));
  // The fewest decimals at which every tick reads differently
  // (tickDecimals) and exactly (0.025 steps: three, never "0.13"), each
  // tick with its unit: "−0.02pp … 0pp", "0.1%"
  const exact = ticks.length ? [0, 1, 2, 3, 4, 5, 6].find((d) => ticks.every((t) => Math.abs(Number(t.toFixed(d)) - t) < 1e-9)) ?? 6 : 0;
  const decimals = Math.max(tickDecimals(ticks, 0, 6), exact);
  const tickUnit = isPp(metric) ? "pp" : "%";
  const tick = (value) => {
    const text = Math.abs(value).toFixed(decimals);
    return Number(text) === 0 ? `0${tickUnit}` : `${value < 0 ? "−" : ""}${text}${tickUnit}`;
  };
  const selected = data.find((point) => point.year === selectedYear);
  // "about 5,000 people", "under 1,000 children": the selected year's people
  const selectedCount = (() => {
    const millions = selected?.value != null && metric.group && population ? population(selectedYear, metric.group) : null;
    if (!millions) return null;
    const people = Math.abs((selected.value / 100) * millions * 1e6);
    const who = metric.group === "children" ? "children" : "people";
    return people < 1000 ? `under 1,000 ${who}` : `about ${roundPeople(people)} ${who}`;
  })();
  const height = narrow ? 300 : 340;

  const download = {
    chartRef,
    name: metric.file,
    exportOptions: { title: metric.title, description: metric.description, logo: CHART_LOGO },
    csv: () =>
      byMeasure
        ? buildChartCsv({
            title: `${metric.title}, each policy on its own`,
            units: metric.csvUnits,
            columns: [
              { key: "year", label: "Fiscal year" },
              ...byMeasure.map((m) => ({ key: m.id, label: `${m.name}: ${metric.csvLabel ?? metric.unit}`, decimals: 4 })),
            ],
            rows: measureData.map((point) => ({ ...point, year: fiscalYearTick(point.year) })),
            notes: ["Each column is one policy simulated on its own; the columns are not added up."],
          })
        : buildChartCsv({
            title: metric.title,
            units: metric.csvUnits,
            columns: [
              { key: "year", label: "Fiscal year" },
              { key: "value", label: metric.csvLabel ?? metric.unit, decimals: 4 },
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
          {/* One short line: the selected year's figure; what the chart
              measures is in About this chart */}
          <p className="chart-description">
            {selected?.value != null ? (
              Math.round(selected.value * 1e6) === 0 ? (
                `In ${fiscalYearTick(selectedYear)} the selected policies do not change ${subjectOf(metric)}.`
              ) : (
                metricSentence(metric, fiscalYearTick(selectedYear), selected.value, selectedCount)
              )
            ) : byMeasure ? (
              (() => {
                const top = yearEffects(byMeasure, selectedYear, metric.decimals).rows[0];
                return top ? (
                  <>
                    {fiscalYearTick(selectedYear)}, each policy on its own: biggest {top.name},{" "}
                    {top.value > 0 ? "+" : "−"}
                    {metric.format(top.value)}.
                  </>
                ) : (
                  <>{metric.short ?? metric.description} Each selected policy on its own.</>
                );
              })()
            ) : (
              metric.short ?? metric.description
            )}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={metric.title} period={`${fiscalYearTick(years[0])} to ${fiscalYearTick(years[years.length - 1])}`} />
      </div>
      {/* The measure, as the cards beside it choose theirs: one pill per
          choice ("Inequality measure: Gini ▾") under the description, in
          the card's controls row */}
      {/* With the choice above the pair (PovertyMeasuresRow), none here */}
      {((controls.length > 0 && !choiceAbove) || byMeasure) && (
        <div className="chart-controls ls-controls summary-metric-choices">
          <ControlBar
            name={metric.title}
            options={[
              ...(choiceAbove ? [] : controls),
              ...(byMeasure ? [{ label: "View", value: effectView, onChange: setEffectView, options: EFFECT_VIEWS }] : []),
            ]}
          />
        </div>
      )}
      <div ref={chartRef} className={(controls.length > 0 && !choiceAbove) || byMeasure ? "summary-metric-plot" : undefined}>
        {byMeasure ? (
          <MeasureEffectsView byMeasure={byMeasure} metric={metric} selectedYear={selectedYear} view={effectView} narrow={narrow} years={years} />
        ) : !run && !byMeasure ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>No policy is selected that this chart covers</p>
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
              {/* The header-selected year, shaded as on every year chart */}
              <Customized component={<SelectedYearShade value={selectedYear} />} />
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
                    note={(point) => (point?.value ? peopleText(point.year, point.value) : null)}
                  />
                }
              />
              <Bar
                dataKey="value"
                name={metric.title}
                fill={metric.choices === "inequality" ? INEQUALITY_FILL : CHART_COLOURS.gain}
                shape={VALUE_BAR_SHAPE}
                {...chartMotion()}
              >
                {data.map((point) => {
                  const colour =
                    metric.choices === "inequality"
                      ? INEQUALITY_FILL
                      : point.value > 0
                        ? CHART_COLOURS.loss
                        : CHART_COLOURS.gain;
                  return (
                    <Cell
                      key={point.year}
                      fill={colour}
                      fillOpacity={point.year === selectedYear ? 1 : UNSELECTED_OPACITY}
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
      {/* What the chart measures, in About this chart */}
      <div className="chart-footer">
        <ChartMoreInfo
          info={{
            shows: metric.description,
            how: byMeasure
              ? [
                  "No published run covers this selection together, so each bar is one policy simulated on its own.",
                  "These changes can't be added up across policies.",
                ]
              : [],
            method: { anchor: METHOD_ANCHORS.poverty, label: "How we measure poverty and inequality" },
          }}
        />
      </div>
    </div>
  );
}

export default SummaryMetricChart;

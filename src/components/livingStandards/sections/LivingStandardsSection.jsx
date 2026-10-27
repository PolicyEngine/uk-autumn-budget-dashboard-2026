// Household income: the "Median income" view of the Incomes over time card.
// Ported from PolicyEngine/uk-living-standards-outlook (LivingStandardsSection).
// The summary runs from 2027-28 (headlineSpan).

import { useMemo, useState } from "react";
import { lineLegendItems } from "../LsCharts";
import OverTimeChart from "../OverTimeChart";
import {
  changeVerb,
  fyDash,
  fyLabel,
  headlineSpan,
  formatPounds,
  formatPoundsKAxis,
  formatPoundsWholeAxis,
  rowsPeriod,
} from "../../../utils/livingStandards/outlook";
import {
  EMPTY,
  NO_OFFICIAL_SERIES,
  chartEndYear,
  lineSeries,
  mergeSeries,
  niceAxis,
  projectionStartYear,
  trimProjection,
  visibleRows,
} from "../../../utils/livingStandards/baseline";
import { periodOption, yearsOption } from "../controlOptions";
import { rangeYears } from "../../../utils/livingStandards/yearRange";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, HBAI_SOURCE, HbaiSource } from "../sources";
import { METHOD_ANCHORS } from "../../methodology/anchors";

/** meta.units[metric] may be a string or an object with a label/unit field. */
function unitFor(meta, metric) {
  const u = meta?.units?.[metric];
  if (!u) return null;
  if (typeof u === "string") return u;
  return u.label || u.unit || u.description || null;
}

/** "Median equivalised income (BHC)" -> "Median income after adjusting for household size (BHC)". */
/** "£43,100": pounds to the nearest £100, in full. */
const poundsFull = (v) => `£${(Math.round(v / 100) * 100).toLocaleString("en-GB")}`;

function plainMetric(label) {
  return label.replace(/equivalised income/i, "income after adjusting for household size");
}

function describeMetric(id, label) {
  const equivalised = /equivalised/i.test(id) || /equivalised/i.test(label);
  const concept = equivalised
    ? "household net income adjusted for household size and composition (equivalised)"
    : "household net income";
  if (/median/i.test(id)) return `${label} is the middle value when people are ranked by ${concept}.`;
  if (/mean/i.test(id)) return `${label} is the average of ${concept} across people.`;
  return "";
}

/** The Median income view: card parts for the Incomes over time card. */
// "median", "ahc" -> "median_equivalised_income_ahc"
const metricId = (avg, housing) => `${avg}_equivalised_income${housing === "ahc" ? "_ahc" : ""}`;

export default function useHouseholdIncomeView(data, range = null, setRange = null) {
  const living = data.living_standards;
  const meta = data.meta;
  const metricIds = Object.keys(living.metrics);
  // Default to a metric with official history so both lines show.
  const defaultMetric = metricIds.includes("median_equivalised_income")
    ? "median_equivalised_income"
    : metricIds.find((id) => (living.outturn?.[id] || []).length > 0) || metricIds[0];
  const [metric, setMetric] = useState(defaultMetric);
  const [adjustment, setAdjustment] = useState("real");
  const [viewMode, setViewMode] = useState("both");

  const startYear = useMemo(() => projectionStartYear(data), [data]);
  const endYear = chartEndYear(data);
  const outturn = living.outturn?.[metric] || EMPTY;
  const projection = useMemo(
    () => trimProjection(living.projection?.[metric], startYear, endYear),
    [living, metric, startYear, endYear],
  );
  // AHC outturn is published in real terms only (nominal is null).
  const noOutturn = !outturn.some((d) => d[adjustment] != null);
  const realOnlyOutturn = noOutturn && outturn.some((d) => d.real != null);
  // With no outturn for this metric, Outturn is disabled and Both shows the projection only.
  const effectiveView = noOutturn && viewMode === "outturn" ? "both" : viewMode;

  const chartData = useMemo(
    () => visibleRows(mergeSeries(outturn, projection, (d) => d[adjustment]), effectiveView),
    [outturn, projection, adjustment, effectiveView],
  );
  const axis = niceAxis(Math.max(...chartData.flatMap((d) => [d.historical ?? 0, d.projection ?? 0])));
  const yMax = axis.domain[1];

  const priceBase = fyDash(meta.real_price_base);
  const label = living.metrics[metric];
  const units = unitFor(meta, metric);
  const realSuffix = adjustment === "real" ? `, ${priceBase} prices` : ", cash terms";
  const yFormat = yMax >= 10000 ? formatPoundsKAxis : formatPoundsWholeAxis;
  const series = lineSeries(effectiveView, !noOutturn);
  const yLabel = `${units ? units.split(",")[0] : "Household income"}${realSuffix}`;

  // One plain sentence on the card: who, how much, over which years. The
  // measure's definition (housing costs, prices, household size) is in
  // About this chart.
  let summary = null;
  const span = headlineSpan(projection, data, range);
  if (span) {
    const [first, last] = span;
    const a = first[adjustment];
    const b = last[adjustment];
    if (a != null && b != null && a !== 0) {
      const pct = ((b - a) / a) * 100;
      const verb = changeVerb(pct, "%");
      const who = metric.startsWith("mean") ? "mean income (adjusted for household size)" : "median income (adjusted for household size)";
      // Prices (real or cash) are said in About this chart
      const real = ", ";
      summary = verb ? (
        <>
          Under current law{real}{who} <strong>{verb}</strong>, from about {poundsFull(a)} a year in {fyDash(first.year)} to{" "}
          {poundsFull(b)} in {fyDash(last.year)}.
        </>
      ) : (
        <>
          Under current law{real}{who} <strong>stays at about {poundsFull(a)}</strong> a year from {fyDash(first.year)} to{" "}
          {fyDash(last.year)}.
        </>
      );
    }
  }

  const description = `${describeMetric(metric, label)}${
    adjustment === "real" ? ` Real values are in ${priceBase} prices.` : ""
  }`;

  const csv = () =>
    seriesCsv({
      title: `Household income: ${label}`,
      units: yLabel,
      source: CSV_SOURCES.hbai,
      rows: chartData,
      series,
    });

  return {
    period: rowsPeriod(chartData, "year", fyLabel),
    summary,
    about: description,
    notes: [
      noOutturn &&
        (realOnlyOutturn
          ? "Official incomes after housing costs are shown in real terms only."
          : `${NO_OFFICIAL_SERIES}.`),
      units && `Incomes are in ${units}.`,
      meta.headline_end_year_note,
      /_ahc$/.test(metric) && meta.cpi_ahc_note,
    ],
    source: <HbaiSource />,
    sourceText: CSV_SOURCES.hbai,
    info: {
      how: [
        units && "Equivalised: incomes are adjusted for household size, shown as for a couple with no children.",
        adjustment === "real" ? `Real terms, in ${priceBase} prices.` : "Cash terms, not adjusted for prices.",
      ],
      caveats: [
        noOutturn &&
          (realOnlyOutturn ? "Official incomes after housing costs are shown in real terms only." : `${NO_OFFICIAL_SERIES}.`),
        /_ahc$/.test(metric) && "Real incomes after housing costs use a PolicyEngine CPI after housing costs, not an OBR series.",
      ],
      sources: [HBAI_SOURCE],
      method: { anchor: METHOD_ANCHORS.forecastFeed, label: "How the OBR forecast feeds these incomes" },
    },
    download: chartData.length
      ? { filename: `living-standards-${metric}-${adjustment}`, legendItems: lineLegendItems(series), csv }
      : null,
    // The card's one Options pill: the years compared, the average, then
    // the rest (ControlBar)
    controls: {
      options: [
        yearsOption(rangeYears(data), range, setRange),
        {
          label: "Average",
          value: metric.startsWith("mean") ? "mean" : "median",
          onChange: (avg) => setMetric(metricId(avg, metric.endsWith("_ahc") ? "ahc" : "bhc")),
          options: [
            { value: "median", label: "Median" },
            { value: "mean", label: "Mean" },
          ].map((o) => ({ ...o, disabled: !metricIds.includes(metricId(o.value, metric.endsWith("_ahc") ? "ahc" : "bhc")) })),
        },
        {
          // Worded as every housing-costs choice on the dashboard
          label: "Housing costs",
          value: metric.endsWith("_ahc") ? "ahc" : "bhc",
          onChange: (h) => setMetric(metricId(metric.startsWith("mean") ? "mean" : "median", h)),
          options: [
            { value: "bhc", label: "Before housing costs", summary: "Before housing costs" },
            { value: "ahc", label: "After housing costs", summary: "After housing costs" },
          ].map((o) => ({ ...o, disabled: !metricIds.includes(metricId(metric.startsWith("mean") ? "mean" : "median", o.value)) })),
        },
        {
          label: "Prices",
          value: adjustment,
          onChange: setAdjustment,
          options: [
            { value: "real", label: "Real" },
            { value: "nominal", label: "Cash terms" },
          ],
        },
        periodOption(effectiveView, setViewMode, noOutturn
          ? (realOnlyOutturn ? "Official series in real terms only" : NO_OFFICIAL_SERIES)
          : null),
      ],
    },
    chart:
      chartData.length === 0 ? (
        <div className="chart-plot">
          <div className="plot-empty">No data for this metric.</div>
        </div>
      ) : (
        <OverTimeChart
          compare={range}
          data={chartData}
          series={series}
          yFormat={yFormat}
          tooltipFormat={formatPounds}
          valueFormat={poundsFull}
          yLabel={yLabel}
        />
      ),
  };
}

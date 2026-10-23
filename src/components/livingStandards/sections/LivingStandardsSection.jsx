// Household income card. Ported from PolicyEngine/uk-living-standards-outlook
// (LivingStandardsSection); text and figures unchanged.

import { useMemo, useState } from "react";
import LsCard from "../LsCard";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import {
  changeVerb,
  fyDash,
  headlineSpan,
  formatPounds,
  formatPoundsKAxis,
  formatPoundsWholeAxis,
} from "../../../utils/livingStandards/outlook";
import {
  EMPTY,
  NO_OFFICIAL_SERIES,
  VIEW_OPTIONS,
  chartEndYear,
  lineSeries,
  mergeSeries,
  niceAxis,
  projectionStartYear,
  trimProjection,
  visibleRows,
} from "../../../utils/livingStandards/baseline";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import Note from "../../Note";
import { CSV_SOURCES, HbaiSource } from "../sources";

/** meta.units[metric] may be a string or an object with a label/unit field. */
function unitFor(meta, metric) {
  const u = meta?.units?.[metric];
  if (!u) return null;
  if (typeof u === "string") return u;
  return u.label || u.unit || u.description || null;
}

/** "Median equivalised income (BHC)" -> "Median income after adjusting for household size (BHC)". */
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

export default function LivingStandardsSection({ data }) {
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

  // One sentence: what the measure is (a few words) and how it moves to the
  // headline year. Units live in the unit label.
  let summary = null;
  const span = headlineSpan(projection, data);
  if (span) {
    const [first, last] = span;
    const a = first[adjustment];
    const b = last[adjustment];
    if (a != null && b != null && a !== 0) {
      const verb = changeVerb(((b - a) / a) * 100, "%");
      summary = (
        <>
          {plainMetric(label)}
          {adjustment === "real" ? ` in ${priceBase} prices` : " in cash terms"}{" "}
          {verb ? (
            <>
              <strong>{verb}</strong>, from {formatPounds(a)} in {fyDash(first.year)} to {formatPounds(b)} by{" "}
              {fyDash(last.year)}.
            </>
          ) : (
            <>
              <strong>stays flat</strong> at {formatPounds(a)} from {fyDash(first.year)} to {fyDash(last.year)}.
            </>
          )}
        </>
      );
    }
  }

  const description = `${describeMetric(metric, label)}${
    adjustment === "real" ? ` Real values are in ${priceBase} prices.` : ""
  }`;

  return (
    <LsCard
      title="Household income"
      about={description}
      summary={summary}
      source={<HbaiSource />}
      download={
        chartData.length
          ? {
              filename: `living-standards-${metric}-${adjustment}`,
              legendItems: lineLegendItems(series),
              csv: () =>
                seriesCsv({
                  title: `Household income: ${label}`,
                  units: yLabel,
                  source: CSV_SOURCES.hbai,
                  rows: chartData,
                  series,
                }),
            }
          : null
      }
      controls={
        <>
          <PillSelect
            variant="light"
            prefix="Measure"
            name="Income metric"
            value={metric}
            onChange={setMetric}
            options={metricIds.map((id) => ({ value: id, label: living.metrics[id] }))}
          />
          <PillSelect
            variant="light"
            prefix="Prices"
            name="Price basis"
            value={adjustment}
            onChange={setAdjustment}
            options={[
              { value: "real", label: "Real" },
              { value: "nominal", label: "Cash terms" },
            ]}
          />
          <PillSelect
            variant="light"
            prefix="Period"
            name="Series shown"
            value={effectiveView}
            onChange={setViewMode}
            options={VIEW_OPTIONS.map((o) =>
              o.value === "outturn" && noOutturn
                ? { ...o, disabled: true, title: realOnlyOutturn ? "Official series in real terms only" : NO_OFFICIAL_SERIES }
                : o,
            )}
          />
        </>
      }
      footer={
        noOutturn && (
          <Note>
            {realOnlyOutturn
              ? "Official incomes after housing costs are shown in real terms only."
              : `${NO_OFFICIAL_SERIES}.`}
          </Note>
        )
      }
      notes={[units && `Incomes are in ${units}.`]}
    >
      {chartData.length === 0 ? (
        <div className="chart-plot">
          <div className="chart-empty">No data for this metric.</div>
        </div>
      ) : (
        <LsLineChart
          data={chartData}
          series={series}
          yFormat={yFormat}
          tooltipFormat={formatPounds}
          yLabel={yLabel}
          yDomain={axis.domain}
          yTicks={axis.ticks}
        />
      )}
    </LsCard>
  );
}

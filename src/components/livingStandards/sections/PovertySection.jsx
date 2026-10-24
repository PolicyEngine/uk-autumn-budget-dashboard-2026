// Poverty rate: the Rate view of the Poverty over time card. Ported from
// PolicyEngine/uk-living-standards-outlook (PovertySection).

import { useMemo, useState } from "react";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { changeVerb, fyDash, formatPct, formatPctAxis, headlineSpan, round1, rowsPeriod } from "../../../utils/livingStandards/outlook";
import {
  EMPTY,
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
import { CSV_SOURCES, HbaiSource } from "../sources";

const GROUP_SUFFIX = {
  all: "",
  children: " among children",
  working_age: " among working-age adults",
  pensioners: " among pensioners",
};

/** The Rate view: card parts for the Poverty over time card. */
export default function usePovertyRateView(data) {
  const poverty = data.poverty;
  const measureIds = Object.keys(poverty.measures);
  const groupIds = Object.keys(poverty.groups);
  const [measure, setMeasure] = useState(measureIds[0]);
  const [group, setGroup] = useState(groupIds[0]);
  const [viewMode, setViewMode] = useState("both");

  const startYear = useMemo(() => projectionStartYear(data), [data]);
  const outturn = poverty.outturn?.[measure]?.[group] || EMPTY;
  const projection = useMemo(
    () => trimProjection(poverty.projection?.[measure]?.[group], startYear, chartEndYear(data)),
    [poverty, measure, group, startYear, data],
  );

  const chartData = useMemo(
    () =>
      visibleRows(
        mergeSeries(outturn, projection, (d) => (d.rate == null ? null : d.rate * 100)),
        viewMode,
      ),
    [outturn, projection, viewMode],
  );
  const axis = niceAxis(Math.max(...chartData.flatMap((d) => [d.historical ?? 0, d.projection ?? 0])));

  const isAbsolute = measure.startsWith("absolute");
  const isAHC = measure.endsWith("ahc");
  const groupName = poverty.groups[group].toLowerCase();

  let summary = null;
  const span = headlineSpan(projection, data);
  if (span && span[0].rate != null && span[1].rate != null) {
    const [first, last] = span;
    const a = round1(first.rate * 100);
    const b = round1(last.rate * 100);
    const verb = changeVerb(b - a, "pp");
    const kind = isAbsolute ? "Absolute" : "Relative";
    const line = isAbsolute ? "fixed real-terms line" : "60% of current median";
    summary = (
      <>
        {kind} poverty{GROUP_SUFFIX[group] ?? ""} ({isAHC ? "AHC" : "BHC"}, {line}){" "}
        {verb ? (
          <>
            <strong>{verb}</strong>, from {formatPct(a)} in {fyDash(first.year)} to {formatPct(b)} by{" "}
            {fyDash(last.year)}.
          </>
        ) : (
          <>
            <strong>stays flat</strong> at {formatPct(a)} from {fyDash(first.year)} to {fyDash(last.year)}.
          </>
        )}
      </>
    );
  }

  const noOutturn = outturn.length === 0;
  const noProjection = projection.length === 0;
  const visibleEmpty =
    (viewMode === "outturn" && noOutturn) || (viewMode === "forecast" && noProjection) || chartData.length === 0;
  const series = lineSeries(viewMode, !noOutturn);

  const description = `${
    isAbsolute
      ? "Absolute poverty measures income below a fixed line (60% of the 2024-25 median) held constant in real terms."
      : "Relative poverty measures income below 60% of the contemporary median income."
  } ${isAHC ? "After housing costs." : "Before housing costs."}`;

  return {
    period: visibleEmpty ? null : rowsPeriod(chartData),
    summary,
    about: description,
    notes: [
      !visibleEmpty &&
        noOutturn &&
        viewMode === "both" &&
        `No official outturn series for ${groupName} on this measure; projection only.`,
      ...(poverty.notes || []),
    ],
    source: <HbaiSource />,
    sourceText: CSV_SOURCES.hbai,
    download: visibleEmpty
      ? null
      : {
          filename: `poverty-${measure}-${group}`,
          legendItems: lineLegendItems(series),
          csv: () =>
            seriesCsv({
              title: `Poverty rate: ${poverty.measures[measure]}, ${poverty.groups[group]}`,
              units: "% of people",
              source: CSV_SOURCES.hbai,
              rows: chartData,
              series,
            }),
        },
    controls: (
      <>
        <PillSelect
          variant="light"
          prefix="Measure"
          name="Poverty measure"
          value={measure}
          onChange={setMeasure}
          options={measureIds.map((id) => ({ value: id, label: poverty.measures[id] }))}
        />
        <PillSelect
          variant="light"
          prefix="Group"
          name="Population group"
          value={group}
          onChange={setGroup}
          options={groupIds.map((id) => ({ value: id, label: poverty.groups[id] }))}
        />
        <PillSelect variant="light" prefix="Period" name="Series shown" value={viewMode} onChange={setViewMode} options={VIEW_OPTIONS} />
      </>
    ),
    chart: visibleEmpty ? (
      <div className="chart-plot">
        <div className="plot-empty">
          {viewMode === "outturn" && noOutturn
            ? `No official outturn series for ${groupName} on this measure.`
            : "No projection for this selection."}
        </div>
      </div>
    ) : (
      <LsLineChart
        data={chartData}
        series={series}
        yFormat={formatPctAxis}
        tooltipFormat={formatPct}
        yLabel="Poverty rate"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}

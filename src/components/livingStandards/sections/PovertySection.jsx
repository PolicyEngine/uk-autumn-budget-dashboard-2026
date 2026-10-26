// Poverty rate: the Rate view of the Poverty over time card. Ported from
// PolicyEngine/uk-living-standards-outlook (PovertySection).

import { useMemo, useState } from "react";
import { povertyMeasureOptions } from "../PovertyMeasurePills";
import { periodOption, yearsOption } from "../controlOptions";
import { rangeYears } from "../../../utils/livingStandards/yearRange";
import { usePovertyMeasure } from "../../../utils/livingStandards/povertyMeasure";
import { lineLegendItems } from "../LsCharts";
import OverTimeChart from "../OverTimeChart";
import { changeVerb, fyDash, formatPct, formatPctAxis, headlineSpan, round1, rowsPeriod } from "../../../utils/livingStandards/outlook";
import {
  EMPTY,
  chartEndYear,
  shortLabel,
  lineSeries,
  mergeSeries,
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
export default function usePovertyRateView(data, range = null, setRange = null) {
  const poverty = data.poverty;
  const measureIds = Object.keys(poverty.measures);
  const groupIds = Object.keys(poverty.groups);
  // Absolute, before housing costs, at first, as on Population impact's
  // Poverty sub-tab; shared with the sub-tab's tiles and Who is in poverty (usePovertyMeasure)
  const [chosenMeasure, setMeasure] = usePovertyMeasure();
  const measure = measureIds.includes(chosenMeasure) ? chosenMeasure : measureIds[0];
  const [group, setGroup] = useState(groupIds[0]);
  const [viewMode, setViewMode] = useState("both");

  const startYear = useMemo(() => projectionStartYear(data), [data]);
  const outturn = poverty.outturn?.[measure]?.[group] || EMPTY;
  const projection = trimProjection(poverty.projection?.[measure]?.[group], startYear, chartEndYear(data));

  const chartData = useMemo(
    () =>
      visibleRows(
        mergeSeries(outturn, projection, (d) => (d.rate == null ? null : d.rate * 100)),
        viewMode,
      ),
    [outturn, projection, viewMode],
  );

  const isAbsolute = measure.startsWith("absolute");
  const isAHC = measure.endsWith("ahc");
  const groupName = poverty.groups[group].toLowerCase();

  // One plain sentence on the card; the poverty line and housing costs
  // are defined in About this chart
  let summary = null;
  const span = headlineSpan(projection, data, range);
  if (span && span[0].rate != null && span[1].rate != null) {
    const [first, last] = span;
    const a = round1(first.rate * 100);
    const b = round1(last.rate * 100);
    const who = group === "all" ? "people" : groupName;
    const kind = isAbsolute ? "absolute" : "relative";
    summary =
      a === b ? (
        <>
          Under current law, the share of {who} in {kind} poverty <strong>stays at {formatPct(a)}</strong> from{" "}
          {fyDash(first.year)} to {fyDash(last.year)}.
        </>
      ) : (
        <>
          Under current law, the share of {who} in {kind} poverty <strong>{b > a ? "rises" : "falls"}</strong> from{" "}
          {formatPct(a)} in {fyDash(first.year)} to {formatPct(b)} in {fyDash(last.year)}.
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
    // The years compared are the section's (CurrentLawSection); every
    // choice sits under the card's Options (ControlBar)
    controls: {
      options: [
        yearsOption(rangeYears(data), range, setRange),
        ...povertyMeasureOptions(measure, measureIds, setMeasure),
        {
          label: "People",
          value: group,
          onChange: setGroup,
          options: groupIds.map((id) => ({ value: id, label: poverty.groups[id] })),
        },
        periodOption(viewMode, setViewMode),
      ],
    },
    chart: visibleEmpty ? (
      <div className="chart-plot">
        <div className="plot-empty">
          {viewMode === "outturn" && noOutturn
            ? `No official outturn series for ${groupName} on this measure.`
            : "No projection for this selection."}
        </div>
      </div>
    ) : (
      <OverTimeChart
        compare={range}
        data={chartData}
        series={series}
        yFormat={formatPctAxis}
        tooltipFormat={formatPct}
        yLabel="Poverty rate"
      />
    ),
  };
}

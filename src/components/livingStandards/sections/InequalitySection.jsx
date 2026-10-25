// Inequality: the Inequality view of the Incomes over time card. Gini and
// 90:10, BHC or AHC; HBAI outturn solid, projection dashed. Ported from
// PolicyEngine/uk-living-standards-outlook.

import { useMemo, useState } from "react";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import {
  EMPTY,
  VIEW_OPTIONS,
  lineSeries,
  mergeSeries,
  rangeAxis,
  shortLabel,
  visibleRows,
} from "../../../utils/livingStandards/baseline";
import { fyDash, headlineSpan, rowsPeriod } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, HbaiSource } from "../sources";

const FORMAT = {
  gini: (v) => v.toFixed(3),
  p90_p10: (v) => v.toFixed(2),
};

/** The Inequality view: card parts for the Incomes over time card. */
export default function useInequalityView(data) {
  const ineq = data.inequality;
  const [measure, setMeasure] = useState("gini");
  const [basis, setBasis] = useState("bhc");
  const [viewMode, setViewMode] = useState("both");
  const outturn = ineq.outturn?.[measure]?.[basis] || EMPTY;
  const projection = ineq.projection?.[measure]?.[basis] || EMPTY;
  const fmt = FORMAT[measure] || ((v) => v.toFixed(2));

  const rows = useMemo(
    () => visibleRows(mergeSeries(outturn, projection, (d) => d.value), viewMode),
    [outturn, projection, viewMode],
  );
  const axis = rangeAxis(rows.flatMap((r) => [r.historical, r.projection]), { pad: 0.2 });
  const noOutturn = outturn.length === 0;
  const series = lineSeries(viewMode, !noOutturn);

  const span = headlineSpan(projection, data);
  let summary = null;
  if (span) {
    const [a, b] = span;
    const same = fmt(a.value) === fmt(b.value);
    summary = (
      <>
        The {ineq.measures[measure].replace(/ coefficient/, "")} ({basis.toUpperCase()}){" "}
        {same ? (
          <>
            <strong>stays flat</strong> at {fmt(a.value)} from {fyDash(a.year)} to {fyDash(b.year)}
          </>
        ) : (
          <>
            <strong>{b.value > a.value ? "rises" : "falls"}</strong> from {fmt(a.value)} in {fyDash(a.year)} to{" "}
            {fmt(b.value)} by {fyDash(b.year)}
          </>
        )}
        .
      </>
    );
  }

  return {
    period: rowsPeriod(rows),
    summary,
    about:
      "Gini: 0 is perfect equality, 1 is one person holding all income. 90:10: income at the 90th percentile over income at the 10th. Official figures: Households Below Average Income, Table 1.2b.",
    notes: [...(ineq.notes || []).filter((n) => !/^Outturn is/.test(n)), data.meta.headline_end_year_note],
    source: <HbaiSource />,
    sourceText: CSV_SOURCES.hbai,
    download: rows.length
      ? {
          filename: `inequality-${measure}-${basis}`,
          legendItems: lineLegendItems(series),
          csv: () =>
            seriesCsv({
              title: `Inequality: ${ineq.measures[measure]} (${basis.toUpperCase()})`,
              units: ineq.measures[measure],
              source: CSV_SOURCES.hbai,
              rows,
              series,
            }),
        }
      : null,
    controls: (
      <>
        <PillSelect
          variant="light"
          prefix="Measure"
          name="Inequality measure"
          value={measure}
          onChange={setMeasure}
          options={Object.keys(ineq.measures).map((id) => ({
            value: id,
            label: ineq.measures[id],
            badge: shortLabel(ineq.measures[id]),
          }))}
        />
        <PillSelect
          variant="light"
          prefix="Housing"
          name="Housing costs"
          value={basis}
          onChange={setBasis}
          options={Object.keys(ineq.bases).map((id) => ({ value: id, label: id === "bhc" ? "Before (BHC)" : "After (AHC)", badge: id === "bhc" ? "Before" : "After" }))}
        />
        <PillSelect variant="light" prefix="Period" name="Series shown" value={viewMode} onChange={setViewMode} options={VIEW_OPTIONS} />
      </>
    ),
    chart: (
      <LsLineChart
        data={rows}
        series={series}
        yFormat={(v) => (measure === "gini" ? v.toFixed(2) : v.toFixed(1))}
        tooltipFormat={fmt}
        yLabel={ineq.measures[measure]}
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}

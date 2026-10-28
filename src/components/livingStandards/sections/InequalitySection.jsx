// Inequality over time under current law (its own card, beside the
// measures' effect on inequality on Population impact's Living standards
// sub-tab). Gini and 90/10 ratio, named and ordered as that chart's pills
// (SummaryMetricChart INEQUALITY_METRICS); BHC or AHC; HBAI outturn solid, projection dashed. Ported from
// PolicyEngine/uk-living-standards-outlook.

import { useMemo, useState } from "react";
import { rangeYears } from "../../../utils/livingStandards/yearRange";
import { housingOption, periodOption, yearsOption } from "../controlOptions";
import { lineLegendItems } from "../LsCharts";
import OverTimeChart from "../OverTimeChart";
import {
  EMPTY,
  lineSeries,
  OFFICIAL_VS_PE,
  mergeSeries,
  visibleRows,
} from "../../../utils/livingStandards/baseline";
import { fyDash, headlineSpan, rowsPeriod } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, HBAI_SOURCE, HbaiSource } from "../sources";
import { METHOD_ANCHORS } from "../../methodology/anchors";

// Named as on the measures' inequality chart; the data's own name otherwise
const LABELS = { gini: "Gini", p90_p10: "90/10 ratio" };

const FORMAT = {
  gini: (v) => v.toFixed(3),
  p90_p10: (v) => v.toFixed(2),
};

/** The Inequality view: card parts for the Incomes over time card. */
export default function useInequalityView(data, range = null, setRange = null) {
  const ineq = data.inequality;
  const [measure, setMeasure] = useState("gini");
  const [basis, setBasis] = useState("bhc");
  const [viewMode, setViewMode] = useState("both");
  const outturn = ineq.outturn?.[measure]?.[basis] || EMPTY;
  const projection = ineq.projection?.[measure]?.[basis] || EMPTY;
  const fmt = FORMAT[measure] || ((v) => v.toFixed(2));
  const label = (id) => LABELS[id] ?? ineq.measures[id];

  const rows = useMemo(
    () => visibleRows(mergeSeries(outturn, projection, (d) => d.value), viewMode),
    [outturn, projection, viewMode],
  );
  const noOutturn = outturn.length === 0;
  const series = lineSeries(viewMode, !noOutturn);

  const span = headlineSpan(projection, data, range);
  // One plain sentence on the card; what each measure means is in About
  // this chart
  let summary = null;
  if (span) {
    const [a, b] = span;
    const same = fmt(a.value) === fmt(b.value);
    const what =
      measure === "gini"
        ? "income inequality, measured by the Gini coefficient,"
        : "the gap between top and bottom incomes (90:10 ratio)";
    summary = same ? (
      <>
        Under current law, {what} <strong>stays at {fmt(a.value)}</strong> from {fyDash(a.year)} to {fyDash(b.year)}.
      </>
    ) : (
      <>
        Under current law, {what} <strong>{b.value > a.value ? "rises" : "falls"}</strong> from {fmt(a.value)} in{" "}
        {fyDash(a.year)} to {fmt(b.value)} in {fyDash(b.year)}.
      </>
    );
  }

  return {
    period: rowsPeriod(rows),
    summary,
    // What it shows; the two measures are defined once, under Definitions
    about: "How unequal household incomes are each year under current law. The shaded years are the ones compared.",
    notes: [...(ineq.notes || []).filter((n) => !/^Outturn is/.test(n)), data.meta.headline_end_year_note],
    source: <HbaiSource />,
    sourceText: CSV_SOURCES.hbai,
    info: {
      how: [OFFICIAL_VS_PE],
      // Both measures, whichever is shown, next to the Inequality measure
      // choice (Pavel's review, LS5)
      definitions: [
        { term: "Gini coefficient", meaning: "0 when everyone has the same income, 1 when one person has it all." },
        {
          term: "90:10 ratio",
          meaning: "Income of someone 90% of the way up the income scale divided by that of someone 10% of the way up.",
        },
      ],
      caveats: ["Our 2024-25 inequality sits below official figures, so read PolicyEngine's figures as a change, not a level."],
      sources: [{ ...HBAI_SOURCE, note: "Table 1.2b" }],
      method: { anchor: METHOD_ANCHORS.lsNotes, label: "Notes on the inequality data" },
    },
    download: rows.length
      ? {
          filename: `inequality-${measure}-${basis}`,
          legendItems: lineLegendItems(series),
          csv: () =>
            seriesCsv({
              title: `Inequality: ${label(measure)} (${basis.toUpperCase()})`,
              units: label(measure),
              source: CSV_SOURCES.hbai,
              rows,
              series,
            }),
        }
      : null,
    // One Options pill: the years compared first, then the rest (ControlBar)
    controls: {
      options: [
        yearsOption(rangeYears(data), range, setRange),
        {
          label: "Inequality measure",
          value: measure,
          onChange: setMeasure,
          options: Object.keys(ineq.measures).map((id) => ({ value: id, label: label(id) })),
        },
        housingOption(basis, setBasis, Object.keys(ineq.bases)),
        periodOption(viewMode, setViewMode),
      ],
    },
    chart: (
      <OverTimeChart
        data={rows}
        series={series}
        yFormat={(v) => (measure === "gini" ? v.toFixed(2) : v.toFixed(1))}
        tooltipFormat={fmt}
        yLabel={label(measure)}
        span={span ? [span[0].year, span[1].year] : null}
      />
    ),
  };
}

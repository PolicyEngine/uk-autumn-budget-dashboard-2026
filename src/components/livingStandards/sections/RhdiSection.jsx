// OBR real household disposable income per person (obr_rhdi): outturn solid,
// OBR forecast dashed. A national-accounts measure, not comparable in level
// with the survey-based HBAI incomes above. Ported from
// PolicyEngine/uk-living-standards-outlook; text and figures unchanged.

import { useMemo } from "react";
import LsCard from "../LsCard";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { PALETTE, rangeAxis } from "../../../utils/livingStandards/baseline";
import { changeVerb, fyDash, fyStart, formatPounds } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, ObrSource } from "../sources";

export default function RhdiSection({ data }) {
  const r = data.obr_rhdi;
  const rows = useMemo(() => {
    const s = r?.series || [];
    const lastOutturn = s.filter((d) => d.type === "outturn").slice(-1)[0];
    return s.map((d) => ({
      year: fyStart(d.year),
      outturn: d.type === "outturn" ? d.value : null,
      // Start the dashed line at the last outturn year so the two join.
      forecast: d.type !== "outturn" || d === lastOutturn ? d.value : null,
    }));
  }, [r]);
  if (!r || !rows.length) return null;

  const fc = r.series.filter((d) => d.type !== "outturn");
  const a = fc[0];
  const b = fc[fc.length - 1];
  const verb = a && b ? changeVerb(((b.value - a.value) / a.value) * 100, "%") : null;
  const axis = rangeAxis(rows.flatMap((d) => [d.outturn, d.forecast]), { pad: 0.3 });
  const series = [
    { key: "outturn", name: "Outturn (ONS)", colour: PALETTE.grey },
    { key: "forecast", name: "OBR March 2026 forecast", colour: PALETTE.teal, dashed: true },
  ];

  return (
    <LsCard
      title="Real household disposable income per person (OBR)"
      about={`${r.definition}; ${r.unit}. Includes non-profit institutions and imputed income.`}
      summary={
        a &&
        b && (
          <>
            Real household disposable income per person <strong>{verb || "stays flat"}</strong> in the OBR
            forecast, from {formatPounds(a.value)} in {fyDash(a.year)} to{" "}
            {formatPounds(b.value)} by {fyDash(b.year)} (national accounts, not comparable in level with the
            Incomes section).
          </>
        )
      }
      source={<ObrSource />}
      download={{
        filename: "obr-rhdi-per-person",
        legendItems: lineLegendItems(series),
        csv: () =>
          seriesCsv({
            title: "Real household disposable income per person (OBR)",
            units: "£ per person, 2023 prices",
            source: CSV_SOURCES.obr,
            rows,
            series,
          }),
      }}
    >
      <LsLineChart
        data={rows}
        series={series}
        yFormat={formatPounds}
        tooltipFormat={formatPounds}
        yLabel="£ per person, 2023 prices"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    </LsCard>
  );
}

// Rendered only when the outlook data has this block.
RhdiSection.requires = "obr_rhdi";

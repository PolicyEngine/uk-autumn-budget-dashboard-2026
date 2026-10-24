// Growth incidence: real change in each income decile's median from 2027-28
// (headlineStartYear) to the headline end year, from the real medians in
// income_by_decile.<basis>.by_year.
// The By decile view of the Growth across the distribution card. Ported
// from PolicyEngine/uk-living-standards-outlook.

import { useState } from "react";
import PillSelect from "../../PillSelect";
import { LsBarChart } from "../LsCharts";
import { PALETTE, rangeAxis } from "../../../utils/livingStandards/baseline";
import {
  changeVerb,
  fyDash,
  formatOneDp,
  headlineStartYear,
  headlineYear,
  periodLabel,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pct = (v) => `${formatOneDp(v)}%`;

/** The By decile view: card parts for the Growth across the distribution card. */
export default function useDecileView(data) {
  const dec = data.income_by_decile;
  const [basis, setBasis] = useState("bhc");
  const byYear = dec[basis]?.by_year || [];
  const first = byYear.find((r) => r.year === headlineStartYear(data)) || byYear[0];
  const end = byYear.find((r) => r.year === headlineYear(data)) || byYear[byYear.length - 1];

  if (!first || !end) return null;
  const rows = dec.deciles.map((d, i) => ({ decile: d, growth: (end.real_median[i] / first.real_median[i] - 1) * 100 }));
  const axis = rangeAxis(rows.map((r) => r.growth), { includeZero: true, pad: 0.15 });
  const bottom = rows[0].growth;
  const top = rows[rows.length - 1].growth;
  const basisShort = basis.toUpperCase();
  const say = (v) => changeVerb(v, "%") || "stays flat";
  const seriesName = `Real change, ${fyDash(first.year)} to ${fyDash(end.year)}`;
  const legendItems = [
    { label: "Rise", color: PALETTE.teal },
    { label: "Fall", color: PALETTE.amber },
  ];

  const controls = (
    <PillSelect
      variant="light"
      prefix="Housing costs"
      name="Housing costs"
      value={basis}
      onChange={setBasis}
      options={Object.keys(dec.bases).map((id) => ({ value: id, label: id === "bhc" ? "Before (BHC)" : "After (AHC)", badge: id === "bhc" ? "Before" : "After" }))}
    />
  );

  return {
    period: periodLabel(first.year, end.year),
    summary: (
      <>
        From {fyDash(first.year)} to {fyDash(end.year)}, real median income ({basisShort}) in the lowest-income
        tenth <strong>{say(bottom)}</strong>; in the highest-income tenth it <strong>{say(top)}</strong>.
      </>
    ),
    about: `${dec.statistic}. Deciles are re-ranked each year, so this compares positions in the distribution, not the same people.`,
    notes: [...(dec.notes || []).filter((n) => /lowest tenth/i.test(n)), basis === "ahc" && data.meta.cpi_ahc_note],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: {
      filename: `income-growth-by-decile-${basis}`,
      legendItems: legendItems.map((item) => ({ ...item, type: "rect" })),
      csv: () =>
        seriesCsv({
          title: `Income growth by decile (${basisShort})`,
          units: `% real change in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}`,
          source: CSV_SOURCES.pe,
          rows,
          xKey: "decile",
          xLabel: "Income decile (1 = lowest)",
          xFormat: String,
          series: [{ key: "growth", name: seriesName }],
        }),
    },
    controls,
    chart: (
      <LsBarChart
        data={rows}
        xKey="decile"
        xFormat={String}
        xLabel="Income decile (1 = lowest)"
        series={[{ key: "growth", name: seriesName, colour: PALETTE.teal }]}
        signColours={{ positive: PALETTE.teal, negative: PALETTE.amber }}
        legendItems={legendItems}
        yFormat={pctTick}
        tooltipFormat={pct}
        showPlus
        yLabel="Real change (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}

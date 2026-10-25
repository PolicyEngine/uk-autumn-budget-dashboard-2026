// Growth incidence: real change in each income quintile's own median
// between the two chosen years, from the real medians in
// income_by_decile.<basis>.quintile_by_year (the file keeps the decile
// series too). The view of the Growth across the distribution card.

import { useState } from "react";
import PillSelect from "../../PillSelect";
import YearRangeSelect from "../YearRangeSelect";
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

// Quintiles: each group's own median, from the outlook file
const g = { key: "quintile_by_year", groups: "quintiles", noun: "quintile", fifth: "fifth", label: "Income quintile (1 = lowest)" };

/**
 * The quintile view: card parts for the Growth across the distribution
 * card. A file without quintiles gives no view.
 */
export default function useQuintileGrowthView(data, range = null, setRange = null) {
  const dec = data.income_by_decile;
  const [basis, setBasis] = useState("bhc");
  const byYear = dec[basis]?.[g.key] || [];
  const [fromYear, toYear] = range ?? [headlineStartYear(data), headlineYear(data)];
  const first = byYear.find((r) => r.year === fromYear) || byYear[0];
  const end = byYear.find((r) => r.year === toYear) || byYear[byYear.length - 1];

  if (!first || !end || !dec[g.groups]) return null;
  const rows = dec[g.groups].map((d, i) => ({ decile: d, growth: (end.real_median[i] / first.real_median[i] - 1) * 100 }));
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
    <>
    {setRange && (
      <YearRangeSelect years={byYear.map((r) => r.year)} from={first.year} to={end.year} onChange={setRange} />
    )}
    <PillSelect
      variant="light"
      prefix="Housing costs"
      name="Housing costs"
      value={basis}
      onChange={setBasis}
      options={Object.keys(dec.bases).map((id) => ({ value: id, label: id === "bhc" ? "Before (BHC)" : "After (AHC)", badge: id === "bhc" ? "Before" : "After" }))}
    />
    </>
  );

  return {
    period: periodLabel(first.year, end.year),
    summary: (
      <>
        From {fyDash(first.year)} to {fyDash(end.year)}, real median income ({basisShort}) in the lowest-income
        {" "}{g.fifth} <strong>{say(bottom)}</strong>; in the highest-income {g.fifth} it <strong>{say(top)}</strong>.
      </>
    ),
    about: `${dec.statistic.replace("decile", "quintile")}. Groups are re-ranked each year, so this compares positions in the distribution, not the same people.`,
    notes: [basis === "ahc" && data.meta.cpi_ahc_note],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: {
      filename: `income-growth-by-${g.noun}-${basis}`,
      legendItems: legendItems.map((item) => ({ ...item, type: "rect" })),
      csv: () =>
        seriesCsv({
          title: `Income growth by ${g.noun} (${basisShort})`,
          units: `% real change in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}`,
          source: CSV_SOURCES.pe,
          rows,
          xKey: "decile",
          xLabel: g.label,
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
        xLabel={g.label}
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

// Depth of poverty: people below 40%, 40-50% and 50-60% of median income
// (AHC), stacked by year. The 40% and 50% lines come from deep_poverty; the
// 60% line is the relative AHC poverty rate for all people. Ported from
// PolicyEngine/uk-living-standards-outlook. The change runs from 2027-28.
// The Depth view of the Poverty over time card.

import { useMemo } from "react";
import { LsBarChart } from "../LsCharts";
import { PALETTE, niceAxis } from "../../../utils/livingStandards/baseline";
import {
  changeVerb,
  fyDash,
  fyStart,
  formatPct,
  formatPctAxis,
  headlineStartYear,
  headlineYear,
  periodLabel,
  round1,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const EMPTY_ROWS = [];

/** The Depth view: card parts for the Poverty over time card. */
export default function useDepthView(data) {
  const deep = data.deep_poverty.projection;
  const rel = data.poverty?.projection?.relative_ahc?.all || EMPTY_ROWS;

  const rows = useMemo(() => {
    const b50 = Object.fromEntries((deep.below_50pc_median_ahc || []).map((d) => [d.year, d.rate]));
    const b60 = Object.fromEntries(rel.map((d) => [d.year, d.rate]));
    return (deep.below_40pc_median_ahc || [])
      .filter((d) => b50[d.year] != null && b60[d.year] != null)
      .map((d) => ({
        year: fyStart(d.year),
        fy: d.year,
        below40: d.rate * 100,
        band4050: (b50[d.year] - d.rate) * 100,
        band5060: (b60[d.year] - b50[d.year]) * 100,
        total: b60[d.year] * 100,
      }));
  }, [deep, rel]);

  if (!rows.length) return null;
  const axis = niceAxis(Math.max(...rows.map((r) => r.total)));
  const series = [
    { key: "below40", name: "Below 40%", colour: PALETTE.dark },
    { key: "band4050", name: "40–50%", colour: PALETTE.teal },
    { key: "band5060", name: "50–60%", colour: PALETTE.light },
  ];
  const first = rows.find((r) => r.fy === headlineStartYear(data)) || rows[0];
  const end = rows.find((r) => r.fy === headlineYear(data)) || rows[rows.length - 1];
  // From the one-decimal values shown
  const verb = changeVerb(round1(end.below40) - round1(first.below40), "pp");

  return {
    period: periodLabel(rows[0].fy, rows[rows.length - 1].fy),
    summary: (
      <>
        Very deep poverty: {formatPct(end.below40)} of people, <strong>{verb || "flat"}</strong>.
      </>
    ),
    about:
      "People in households below 40%, 50% and 60% of the model's own median income after housing costs each year. Below 40% is JRF's very deep poverty; the three bands add up to the relative poverty rate.",
    notes: [
      <>
        In {fyDash(end.fy)}, {formatPct(end.below40)} of people are in very deep poverty (below 40% of median income,
        AHC), of {formatPct(end.total)} below 60%; very deep poverty {verb || "stays flat"} from {fyDash(first.fy)}.
      </>,
      ...(data.deep_poverty.notes || []).filter((n) => /JRF's figure/.test(n)),
    ],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: {
      filename: "depth-of-poverty",
      legendItems: series.map((s) => ({ color: s.colour, label: s.name, type: "rect" })),
      csv: () =>
        seriesCsv({
          title: "Depth of poverty (AHC)",
          units: "% of people, by band of the model's median income after housing costs",
          source: CSV_SOURCES.pe,
          rows,
          series: [...series, { key: "total", name: "Below 60% (total)" }],
        }),
    },
    controls: null,
    chart: (
      <LsBarChart
        data={rows}
        series={series}
        stacked
        yFormat={formatPctAxis}
        tooltipFormat={formatPct}
        yLabel="People (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}

// Lower- vs higher-income half of non-pensioners: mean equivalised AHC income
// in real terms (income_by_decile.non_pensioner_split). Ported from
// PolicyEngine/uk-living-standards-outlook. Change runs from 2026-27. The
// Lower- vs higher-income halves view of the Growth across the distribution
// card.

import { useMemo, useState } from "react";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, PALETTE, joinSeries, niceAxis, rangeAxis } from "../../../utils/livingStandards/baseline";
import {
  changeVerb,
  fyDash,
  formatOneDp,
  formatPounds,
  formatPoundsKAxis,
  fyStart,
  headlineSpan,
  headlineStartYear,
  rowsPeriod,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pct = (v) => `${formatOneDp(v)}%`;

/** The halves view: card parts for the Growth across the distribution card. */
export default function useHalvesView(data) {
  const split = data.income_by_decile.non_pensioner_split;
  const [view, setView] = useState("change");
  const lower = split.series.below_middle;
  const upper = split.series.above_middle;

  // Change runs from 2026-27 (as the summary does), from the real means;
  // the level shows every year.
  const start = headlineStartYear(data);
  const rows = useMemo(() => {
    const series = (s) => {
      if (view !== "change") return [s, (d) => d.real_mean];
      const base = s.find((d) => d.year === start) || s[0];
      return [s.filter((d) => fyStart(d.year) >= fyStart(base.year)), (d) => (d.real_mean / base.real_mean - 1) * 100];
    };
    return joinSeries([
      ["lower", ...series(lower)],
      ["upper", ...series(upper)],
    ]);
  }, [lower, upper, view, start]);
  const values = rows.flatMap((r) => [r.lower, r.upper]);
  const axis = view === "change" ? rangeAxis(values, { includeZero: true, pad: 0.15 }) : niceAxis(Math.max(...values));

  const sl = headlineSpan(lower, data);
  const su = headlineSpan(upper, data);
  const change = (s) => ((s[1].real_mean - s[0].real_mean) / s[0].real_mean) * 100;
  const say = (v) => changeVerb(v, "%") || "stays flat";
  const base = data.meta.real_price_base;
  const yLabel = view === "change" ? "Real change in mean (%)" : `£ a year, ${fyDash(base)} prices`;

  const series = [
    { key: "lower", name: "Lower-income half", colour: PALETTE.amber, dash: DASH.dot },
    { key: "upper", name: "Higher-income half", colour: PALETTE.teal, dash: DASH.long },
  ];

  return {
    period: rowsPeriod(rows),
    summary: sl && su && (
      <>
        From {fyDash(sl[0].year)} to {fyDash(sl[1].year)}, real mean income (AHC) of the lower-income half of
        non-pensioners <strong>{say(change(sl))}</strong>; that of the higher-income half{" "}
        <strong>{say(change(su))}</strong>.
      </>
    ),
    about: `${split.statistic}. People in families with no pensioner, split at their own median.`,
    notes: [
      ...(data.income_by_decile.notes || []).filter((n) => /halves/i.test(n)),
      view === "level" && data.meta.units?.mean_equivalised_income_ahc && `Incomes are in ${data.meta.units.mean_equivalised_income_ahc}.`,
    ],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: {
      filename: `non-pensioner-halves-${view}`,
      legendItems: lineLegendItems(series),
      csv: () =>
        seriesCsv({
          title: "Non-pensioner income halves",
          units: yLabel,
          source: CSV_SOURCES.pe,
          rows,
          series,
        }),
    },
    controls: (
      <PillSelect
        variant="light"
        prefix="Values"
        name="Change or level"
        value={view}
        onChange={setView}
        options={[
          { value: "change", label: `Change since ${fyDash((lower.find((d) => d.year === start) || lower[0])?.year)}` },
          { value: "level", label: `Level (${fyDash(base)} prices)` },
        ]}
      />
    ),
    chart: (
      <LsLineChart
        data={rows}
        series={series}
        yFormat={view === "change" ? pctTick : formatPoundsKAxis}
        tooltipFormat={view === "change" ? pct : formatPounds}
        showPlus={view === "change"}
        yLabel={yLabel}
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}

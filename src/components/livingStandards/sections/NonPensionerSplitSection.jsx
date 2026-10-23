// Lower- vs higher-income half of non-pensioners: mean equivalised AHC income
// in real terms (income_by_decile.non_pensioner_split). Ported from
// PolicyEngine/uk-living-standards-outlook; text and figures unchanged.

import { useMemo, useState } from "react";
import LsCard from "../LsCard";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, PALETTE, joinSeries, niceAxis, rangeAxis } from "../../../utils/livingStandards/baseline";
import {
  changeVerb,
  fyDash,
  formatOneDp,
  formatPounds,
  formatPoundsKAxis,
  headlineSpan,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pct = (v) => `${formatOneDp(v)}%`;

export default function NonPensionerSplitSection({ data }) {
  const split = data.income_by_decile.non_pensioner_split;
  const [view, setView] = useState("change");
  const lower = split.series.below_middle;
  const upper = split.series.above_middle;

  const rows = useMemo(() => {
    const pick = view === "change" ? (d) => d.cumulative_growth * 100 : (d) => d.real_mean;
    return joinSeries([
      ["lower", lower, pick],
      ["upper", upper, pick],
    ]);
  }, [lower, upper, view]);
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

  return (
    <LsCard
      title="Non-pensioner income halves"
      about={`${split.statistic.replace(/(\d{4})-(\d{2})/g, "$1–$2")}. People in families with no pensioner, split at their own median.`}
      notes={[
        ...(data.income_by_decile.notes || []).filter((n) => /halves/i.test(n)),
        view === "level" && data.meta.units?.mean_equivalised_income_ahc && `Incomes are in ${data.meta.units.mean_equivalised_income_ahc}.`,
      ]}
      summary={
        sl &&
        su && (
          <>
            From {fyDash(sl[0].year)} to {fyDash(sl[1].year)}, real mean income (AHC) of the lower-income half of
            non-pensioners <strong>{say(change(sl))}</strong>; that of the higher-income half{" "}
            <strong>{say(change(su))}</strong>.
          </>
        )
      }
      source={<PeSource />}
      download={{
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
      }}
      controls={
        <PillSelect
          variant="light"
          prefix="Show"
          name="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "change", label: `Change since ${fyDash(lower[0]?.year)}` },
            { value: "level", label: `Level (${fyDash(base)} prices)` },
          ]}
        />
      }
    >
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
    </LsCard>
  );
}

// Rendered only when the outlook data has this block.
NonPensionerSplitSection.requires = "income_by_decile";

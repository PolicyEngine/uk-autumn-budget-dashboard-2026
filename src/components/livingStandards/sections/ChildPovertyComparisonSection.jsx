import { useMemo } from "react";
import LsCard from "../LsCard";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, PALETTE, joinSeries, niceAxis } from "../../../utils/livingStandards/baseline";
import { fyDash, formatPct, formatPctAxis } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { Label, plainWords } from "../sources";

const rate = (d) => (d.rate == null ? null : d.rate * 100);

export default function ChildPovertyComparisonSection({ data }) {
  const cp = data.child_poverty_by_family;
  const comparison = Object.values(cp).find((value) => value?.baseline && value?.counterfactual);

  const rows = useMemo(
    () =>
      joinSeries([
        ["baseline", comparison?.baseline ?? [], rate],
        ["kept", comparison?.counterfactual ?? [], rate],
      ]),
    [comparison],
  );
  if (!comparison) return null;
  const axis = niceAxis(Math.max(...rows.flatMap((r) => [r.baseline ?? 0, r.kept ?? 0])));
  const series = [
    { key: "baseline", name: "Current law", colour: PALETTE.teal, dash: DASH.long },
    { key: "kept", name: comparison.label || "Published comparison", colour: PALETTE.amber, dash: DASH.dot },
  ];

  // notes[0] is the lead sentence (the 2026-27 fall against DWP); the rest
  // explain it. All are computed in the outlook pipeline.
  const [lead, ...notes] = (cp.notes || []).filter((n) => !/UC health element protection/i.test(n));
  const text = (s) => fyDash(plainWords(s));
  const sources = `${(cp.sources || []).join("; ")}${cp.sources?.length ? " · " : ""}PolicyEngine projections`;

  return (
    <LsCard
      title="Child poverty comparison"
      about="Current law and the published comparison. Relative poverty after housing costs: below 60% of the current median income."
      summary={lead && text(lead)}
      notes={notes}
      source={
        <>
          <Label /> {sources}
        </>
      }
      download={{
        filename: "child-poverty-comparison-relative_ahc",
        legendItems: lineLegendItems(series),
        csv: () =>
          seriesCsv({
            title: "Children in relative poverty (AHC)",
            units: "% of children",
            source: sources,
            rows,
            series,
          }),
      }}
    >
      <LsLineChart
        data={rows}
        series={series}
        yFormat={formatPctAxis}
        tooltipFormat={formatPct}
        yLabel="Relative child poverty, AHC (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    </LsCard>
  );
}

// Rendered only when the outlook data has this block.
ChildPovertyComparisonSection.requires = "child_poverty_by_family";

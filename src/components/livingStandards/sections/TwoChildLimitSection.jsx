// Child poverty under current law (two-child limit removed from April 2026)
// against the limit kept (child_poverty_by_family.two_child_limit_kept).
// Relative AHC only: the model's absolute AHC effects are not comparable with
// DWP's absolute estimates, which use an older line. Ported from
// PolicyEngine/uk-living-standards-outlook; text and figures unchanged.

import { useMemo } from "react";
import LsCard from "../LsCard";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, PALETTE, joinSeries, niceAxis } from "../../../utils/livingStandards/baseline";
import { fyDash, formatPct, formatPctAxis } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { Label, plainWords } from "../sources";

const rate = (d) => (d.rate == null ? null : d.rate * 100);

export default function TwoChildLimitSection({ data }) {
  const cp = data.child_poverty_by_family;
  const tcl = cp.two_child_limit_kept;

  const rows = useMemo(
    () =>
      joinSeries([
        ["baseline", tcl.baseline, rate],
        ["kept", tcl.counterfactual, rate],
      ]),
    [tcl],
  );
  const axis = niceAxis(Math.max(...rows.flatMap((r) => [r.baseline ?? 0, r.kept ?? 0])));
  const series = [
    { key: "baseline", name: "Current law (limit removed)", colour: PALETTE.teal, dash: DASH.long },
    { key: "kept", name: tcl.label || "Two-child limit kept", colour: PALETTE.amber, dash: DASH.dot },
  ];

  // notes[0] is the lead sentence (the 2026-27 fall against DWP); the rest
  // explain it. All are computed in the outlook pipeline.
  const [lead, ...notes] = (cp.notes || []).filter((n) => !/UC health element protection/i.test(n));
  const text = (s) => fyDash(plainWords(s));
  const sources = `${(cp.sources || []).join("; ")}${cp.sources?.length ? " · " : ""}PolicyEngine projections`;

  return (
    <LsCard
      title="Two-child limit"
      about="Current law removes the two-child limit in Universal Credit from April 2026; the comparison keeps it. Relative poverty after housing costs: below 60% of the current median income."
      summary={lead && text(lead)}
      notes={notes}
      source={
        <>
          <Label /> {sources}
        </>
      }
      download={{
        filename: "two-child-limit-relative_ahc",
        legendItems: lineLegendItems(series),
        csv: () =>
          seriesCsv({
            title: "Two-child limit: children in relative poverty (AHC)",
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
        yLabel="Children in relative poverty, AHC (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    </LsCard>
  );
}

// Rendered only when the outlook data has this block.
TwoChildLimitSection.requires = "child_poverty_by_family";

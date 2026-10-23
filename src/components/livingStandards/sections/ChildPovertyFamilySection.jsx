// Child poverty by family: number of children (1 / 2 / 3+) or family type
// (lone parent / couple), against all children (child_poverty_by_family).
// Ported from PolicyEngine/uk-living-standards-outlook; text and figures unchanged.

import { useMemo, useState } from "react";
import LsCard from "../LsCard";
import PillSelect from "../../PillSelect";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, PALETTE, joinSeries, niceAxis } from "../../../utils/livingStandards/baseline";
import { fyDash, formatPct, formatPctAxis, headlineYear } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const SPLITS = {
  children: {
    label: "Number of children",
    groups: [
      ["one_child", "1 child", PALETTE.light, DASH.dot],
      ["two_children", "2 children", PALETTE.teal, DASH.long],
      ["three_plus_children", "3+ children", PALETTE.dark, DASH.dashDot],
    ],
  },
  family: {
    label: "Family type",
    groups: [
      ["lone_parent", "Lone-parent", PALETTE.amber, DASH.dot],
      ["couple", "Couple", PALETTE.teal, DASH.long],
    ],
  },
};

/** Group as it reads after "children in ...". */
const PHRASE = {
  one_child: "one-child families",
  two_children: "two-child families",
  three_plus_children: "families with three or more children",
  lone_parent: "lone-parent families",
  couple: "couple families",
};

const EMPTY_PROJECTION = {};

export default function ChildPovertyFamilySection({ data }) {
  const cp = data.child_poverty_by_family;
  const measureIds = Object.keys(cp.measures);
  const [measure, setMeasure] = useState(measureIds[0]);
  const [split, setSplit] = useState("children");
  const groups = SPLITS[split].groups;
  const proj = cp.projection[measure] || EMPTY_PROJECTION;

  const rows = useMemo(
    () =>
      joinSeries([
        ["all", proj.all, (d) => (d.rate == null ? null : d.rate * 100)],
        ...groups.map(([id]) => [id, proj[id], (d) => (d.rate == null ? null : d.rate * 100)]),
      ]),
    [proj, groups],
  );
  const axis = niceAxis(Math.max(...rows.flatMap((r) => groups.map(([id]) => r[id] ?? 0))));
  const series = [
    { key: "all", name: "All children", colour: PALETTE.grey, dash: DASH.solid },
    ...groups.map(([id, name, colour, dash]) => ({ key: id, name, colour, dash })),
  ];

  const end = headlineYear(data);
  const at = (id) => (proj[id] || []).find((r) => r.year === end) || (proj[id] || []).slice(-1)[0];
  const ranked = groups.map(([id, name]) => [name, at(id)?.rate, PHRASE[id]]).filter(([, v]) => v != null);
  ranked.sort((a, b) => b[1] - a[1]);
  const all = at("all");
  const kind = cp.measures[measure].replace(/\s*\(AHC\)/, "").toLowerCase();

  return (
    <LsCard
      title="Child poverty by family"
      about="Share of children in households below the poverty line, after housing costs. Relative: 60% of current median income; absolute: a fixed real-terms line."
      summary={
        all &&
        ranked.length > 0 && (
          <>
            In {fyDash(all.year)}, {kind} child poverty (AHC) is highest for children in{" "}
            <strong>{ranked[0][2]}</strong> at {formatPct(ranked[0][1] * 100)}, against {formatPct(all.rate * 100)} for
            all children.
          </>
        )
      }
      source={<PeSource />}
      download={{
        filename: `child-poverty-${split}-${measure}`,
        legendItems: lineLegendItems(series),
        csv: () =>
          seriesCsv({
            title: `Child poverty by family: ${cp.measures[measure]}, by ${SPLITS[split].label.toLowerCase()}`,
            units: "% of children",
            source: CSV_SOURCES.pe,
            rows,
            series,
          }),
      }}
      controls={
        <>
          <PillSelect
            variant="light"
            prefix="Measure"
            name="Poverty measure"
            value={measure}
            onChange={setMeasure}
            options={measureIds.map((id) => ({ value: id, label: cp.measures[id] }))}
          />
          <PillSelect
            variant="light"
            prefix="Split by"
            name="Split by"
            value={split}
            onChange={setSplit}
            options={Object.entries(SPLITS).map(([id, s]) => ({ value: id, label: s.label }))}
          />
        </>
      }
    >
      <LsLineChart
        data={rows}
        series={series}
        yFormat={formatPctAxis}
        tooltipFormat={formatPct}
        yLabel="Children in poverty (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    </LsCard>
  );
}

// Rendered only when the outlook data has this block.
ChildPovertyFamilySection.requires = "child_poverty_by_family";

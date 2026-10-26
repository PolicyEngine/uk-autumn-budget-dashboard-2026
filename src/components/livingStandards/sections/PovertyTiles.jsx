// Poverty at a glance, on Before the Budget's Poverty sub-tab: one tile
// (HeadlineTile) per age group (children, working-age adults, pensioners)
// on the sub-tab's measure (usePovertyMeasure: the same choice as both
// cards' Options, so a switch to relative or after housing costs moves the
// tiles too). Each tile has the share in poverty in the first year
// compared, the measure's definition in an info tip, a trend of the
// projection from the model's 2024-25 point to the last year compared, and
// one line on where it ends up. The official figures are not drawn here:
// on the same definition the model's levels sit below them (its data are
// reweighted to 2025 totals), so the two read as a fall that is not one.
// The Poverty over time card shows both, with that gap explained. All people is the Poverty over time card's own
// figure, so it has no tile. The years are the cards' shared range.

import { Armchair, Baby, Briefcase } from "lucide-react";
import HeadlineTile from "../HeadlineTile";
import { defaultRange, rangeYears, useYearRange } from "../../../utils/livingStandards/yearRange";
import { DEFAULT_POVERTY_MEASURE, povertyDefinition, usePovertyMeasure } from "../../../utils/livingStandards/povertyMeasure";
import { projectionStartYear } from "../../../utils/livingStandards/baseline";
import { formatPct, fyDash, fyLabel, fyStart, round1 } from "../../../utils/livingStandards/outlook";

const TILES = [
  { group: "children", icon: Baby },
  { group: "working_age", icon: Briefcase },
  { group: "pensioners", icon: Armchair },
];

const pct = (v) => formatPct(round1(v));

/** Where the rate ends up, without repeating the tile's figure. */
export function povertyTileMeaning(a, b, to) {
  const d = round1(b) - round1(a);
  if (Math.abs(d) < 0.05) return `No change by ${fyDash(to)} under current law.`;
  return `${d > 0 ? "Rises" : "Falls"} to ${pct(b)} by ${fyDash(to)} under current law.`;
}

/** A group's projection from `startYear` to `end`, oldest first. */
function trendRows(projection, startYear, end) {
  return (projection || [])
    .filter((r) => r.rate != null && fyStart(r.year) >= startYear && fyStart(r.year) <= end)
    .map((r) => ({ label: fyLabel(fyStart(r.year)), start: fyStart(r.year), value: r.rate * 100 }))
    .sort((a, b) => a.start - b.start);
}

/** The info tip: the measure, and why the levels sit below official figures. */
const tileInfo = (measure) =>
  `${povertyDefinition(measure)} PolicyEngine projection: its levels sit below the official figures because the data are reweighted to 2025 totals, so read it as change over time. Official figures are on the Poverty over time card.`;

export default function PovertyTiles({ data }) {
  const years = rangeYears(data);
  const [[from, to]] = useYearRange(years, defaultRange(years));
  const [chosen] = usePovertyMeasure();
  const poverty = data.poverty;
  const measure = poverty?.projection?.[chosen] ? chosen : DEFAULT_POVERTY_MEASURE;
  const projection = poverty?.projection?.[measure];
  if (!projection) return null;
  const startYear = projectionStartYear(data);
  const kind = measure.startsWith("absolute") ? "absolute" : "relative";

  const tiles = TILES.map((t) => {
    const rows = trendRows(projection[t.group], startYear, fyStart(to));
    const a = rows.find((r) => r.start === fyStart(from))?.value;
    const b = rows.find((r) => r.start === fyStart(to))?.value;
    if (a == null || b == null) return null;
    return { ...t, name: poverty.groups?.[t.group] ?? t.group, rows, a, b };
  }).filter(Boolean);
  if (!tiles.length) return null;

  return (
    <div className="forecast-tiles poverty-tiles">
      {tiles.map((t) => (
        <HeadlineTile
          key={t.group}
          icon={t.icon}
          name={t.name}
          info={tileInfo(measure)}
          value={pct(t.a)}
          caption={`in ${kind} poverty in ${fyDash(from)}`}
          trend={{ rows: t.rows, format: pct, seriesLabel: "PolicyEngine projection", highlight: fyDash(from), dashed: true, minSpan: 2 }}
          meaning={povertyTileMeaning(t.a, t.b, to)}
        />
      ))}
    </div>
  );
}

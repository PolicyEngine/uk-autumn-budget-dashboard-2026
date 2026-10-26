// Poverty at a glance, on the OBR forecast's Poverty sub-tab: one tile
// (HeadlineTile) per age group (children, working-age adults, pensioners)
// on the sub-tab's measure (usePovertyMeasure: the same choice as both
// cards' Options, so a switch to relative or after housing costs moves the
// tiles too). Each tile has the share in poverty in the first year
// compared, the measure's definition in an info tip, a trend of the
// official years and the projection to the last year compared, and one
// line on where it ends up. All people is the Poverty over time card's own
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
  if (Math.abs(d) < 0.05) return `The same in ${fyDash(to)} under current law.`;
  return `${d > 0 ? "Rises" : "Falls"} to ${pct(b)} by ${fyDash(to)} under current law.`;
}

/** A group's official years and projection to `end`, oldest first. */
function trendRows(outturn, projection, startYear, end) {
  const byYear = {};
  const put = (rows, key, keep) =>
    (rows || []).forEach((r) => {
      const yr = fyStart(r.year);
      if (r.rate == null || !keep(yr)) return;
      byYear[yr] = { ...(byYear[yr] || { official: null, projection: null }), [key]: r.rate * 100 };
    });
  put(outturn, "official", (yr) => yr <= end);
  put(projection, "projection", (yr) => yr >= startYear && yr <= end);
  return Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b)
    .map((yr) => ({ label: fyLabel(yr), start: yr, ...byYear[yr] }));
}

export default function PovertyTiles({ data }) {
  const years = rangeYears(data);
  const [[from, to]] = useYearRange(years, defaultRange(years));
  const [chosen] = usePovertyMeasure();
  const poverty = data.poverty;
  const measure = poverty?.projection?.[chosen] ? chosen : DEFAULT_POVERTY_MEASURE;
  const projection = poverty?.projection?.[measure];
  if (!projection) return null;
  const outturn = poverty.outturn?.[measure] || {};
  const startYear = projectionStartYear(data);
  const kind = measure.startsWith("absolute") ? "absolute" : "relative";

  const tiles = TILES.map((t) => {
    const rows = trendRows(outturn[t.group], projection[t.group], startYear, fyStart(to));
    const a = rows.find((r) => r.start === fyStart(from))?.projection;
    const b = rows.find((r) => r.start === fyStart(to))?.projection;
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
          info={povertyDefinition(measure)}
          value={pct(t.a)}
          caption={`in ${kind} poverty in ${fyDash(from)}`}
          rows={t.rows}
          format={pct}
          meaning={povertyTileMeaning(t.a, t.b, to)}
        />
      ))}
    </div>
  );
}

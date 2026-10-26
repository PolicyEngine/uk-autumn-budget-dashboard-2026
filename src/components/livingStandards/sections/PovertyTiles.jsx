// Poverty at a glance, on the OBR forecast's Poverty sub-tab: one tile per
// age group (children, working-age adults, pensioners) on the measure the
// cards open on (absolute, before housing costs). Each tile has an icon,
// the share in poverty in the first year compared, a small line of the
// years compared, and one line on where it ends up. All people is the
// Poverty over time card's own figure, so it has no tile. The years are the
// cards' shared range (useYearRange), so the tiles follow a change there.

import { Armchair, Baby, Briefcase } from "lucide-react";
import { Sparkline } from "./ForecastHeadlineSection";
import { defaultRange, rangeYears, useYearRange } from "../../../utils/livingStandards/yearRange";
import { formatPct, fyDash, round1 } from "../../../utils/livingStandards/outlook";

export const POVERTY_TILE_MEASURE = "absolute_bhc";

const TILES = [
  { group: "children", icon: Baby },
  { group: "working_age", icon: Briefcase },
  { group: "pensioners", icon: Armchair },
];

/** Where the rate ends up, without repeating the tile's figure. */
export function povertyTileMeaning(a, b, to) {
  const d = round1(b) - round1(a);
  if (Math.abs(d) < 0.05) return `The same in ${fyDash(to)} under current law.`;
  return `${d > 0 ? "Rises" : "Falls"} to ${formatPct(round1(b))} by ${fyDash(to)} under current law.`;
}

export default function PovertyTiles({ data }) {
  const years = rangeYears(data);
  const [[from, to]] = useYearRange(years, defaultRange(years));
  const poverty = data.poverty;
  const series = poverty?.projection?.[POVERTY_TILE_MEASURE];
  if (!series) return null;
  const start = Number(String(from).slice(0, 4));
  const end = Number(String(to).slice(0, 4));
  const tiles = TILES.map((t) => {
    const rows = (series[t.group] || [])
      .filter((r) => {
        const y = Number(String(r.year).slice(0, 4));
        return y >= start && y <= end;
      })
      .map((r) => ({ year: fyDash(r.year), value: r.rate == null ? null : r.rate * 100 }));
    const a = rows.find((r) => r.year === fyDash(from))?.value;
    const b = rows.find((r) => r.year === fyDash(to))?.value;
    if (a == null || b == null) return null;
    return { ...t, name: poverty.groups?.[t.group] ?? t.group, rows, a, b };
  }).filter(Boolean);
  if (!tiles.length) return null;

  return (
    <>
    <p className="poverty-tiles-caption">Absolute poverty, before housing costs</p>
    <div className="forecast-tiles poverty-tiles">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.group} className="forecast-tile">
            <div className="forecast-tile-head">
              <span className="forecast-tile-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.8} />
              </span>
              <span className="forecast-tile-name">{t.name}</span>
            </div>
            <div className="forecast-tile-body">
              <div>
                <p className="forecast-tile-value">{formatPct(round1(t.a))}</p>
                <p className="forecast-tile-sub">in poverty in {fyDash(from)}</p>
              </div>
              <Sparkline rows={t.rows} label={`${t.name}, ${t.rows.map((r) => `${r.year}: ${formatPct(round1(r.value))}`).join(", ")}`} />
            </div>
            <p className="forecast-tile-meaning">{povertyTileMeaning(t.a, t.b, to)}</p>
          </div>
        );
      })}
    </div>
    </>
  );
}

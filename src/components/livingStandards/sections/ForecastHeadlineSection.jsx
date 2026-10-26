// The forecast at a glance: one tile per headline series (forecast.headline:
// CPI, RPI, earnings). Each has an icon, the series' name, its growth in
// the first forecast year as a big figure, a small line of the forecast
// years, and one plain line on what it means (forecastWords.tileMeaning),
// which never repeats the figure. The basis and source are in the panel's
// intro, once. The Budget-day forecast is held (ForecastPanel), so a tile
// shows the one published forecast.

import { Briefcase, Coins, House, KeyRound, Percent, Receipt, Tag } from "lucide-react";
import { heroYear, pctLabel, toRows } from "../../../utils/livingStandards/forecast";
import { tileMeaning } from "../../../utils/livingStandards/forecastWords";

// ONS series pages for the tile names (checked 20 Oct 2026). Earnings is not
// linked: the tile is OBR's calendar-year average earnings growth, and ONS
// KAB9 is a level series, not that growth rate; the tile's source is the OBR.
const ONS_SERIES = {
  cpi: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23",
  rpi: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/czbh/mm23",
};

const NAMES = {
  cpi: "Consumer prices (CPI)",
  rpi: "Retail prices (RPI)",
  earnings: "Average earnings",
  non_labour_income: "Non-labour income",
  house_prices: "House prices",
  rent: "Rents",
  mortgage_interest: "Mortgage interest",
};

const ICONS = {
  cpi: Tag,
  cpih: Tag,
  rpi: Receipt,
  earnings: Briefcase,
  non_labour_income: Coins,
  house_prices: House,
  rent: KeyRound,
  mortgage_interest: Percent,
};

// The sparkline's box (CSS scales it to the tile's width)
const W = 120;
const H = 32;
const PAD = 4;

/**
 * A small line of a series' years, its first and last points dotted. The
 * vertical scale spans at least `minSpan` (in the values' units, centred on
 * the series), so a change of a tenth of a point stays a near-flat line
 * rather than filling the box.
 */
export function Sparkline({ rows, label, minSpan = 2 }) {
  const points = rows.filter((r) => r.value != null);
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
  const half = Math.max((Math.max(...vals) - Math.min(...vals)) / 2, minSpan / 2);
  const lo = mid - half;
  const hi = mid + half;
  const y = (v) => PAD + ((hi - v) / (hi - lo)) * (H - 2 * PAD);
  const x = (i) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const coords = points.map((p, i) => [x(i), y(p.value)]);
  const ends = [coords[0], coords[coords.length - 1]];
  return (
    <figure className="forecast-spark">
      {/* The dots sit over the line's box, not the years under it */}
      <div className="forecast-spark-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
          <polyline points={coords.map((c) => c.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {ends.map(([cx, cy], i) => (
          <span key={i} className="forecast-spark-dot" style={{ left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%` }} />
        ))}
      </div>
      <figcaption className="forecast-spark-years">
        <span>{points[0].year}</span>
        <span>{points[points.length - 1].year}</span>
      </figcaption>
    </figure>
  );
}

export default function ForecastHeadlineSection({ data }) {
  const forecast = data.forecast;
  const year = heroYear(forecast);
  const byKey = {};
  forecast.sections.forEach((s) => s.series.forEach((series) => (byKey[series.key] = series)));
  // Every series' rows as { year, value } in percent, for the comparisons
  const rowsOf = (key) => (byKey[key] ? toRows(byKey[key], false).map((r) => ({ year: r.year, value: r.previous })) : null);
  const allRows = Object.fromEntries(Object.keys(byKey).map((key) => [key, rowsOf(key)]));

  const tiles = (forecast.headline || [])
    .map((key) => {
      const rows = allRows[key];
      const row = rows?.find((r) => r.year === year);
      if (!row || row.value == null) return null;
      return { key, name: NAMES[key] ?? byKey[key].label, rows, value: row.value };
    })
    .filter(Boolean);

  if (!tiles.length) return null;

  return (
    <div className="forecast-tiles">
      {tiles.map((tile) => {
        const Icon = ICONS[tile.key] ?? Tag;
        const meaning = tileMeaning(tile.key, tile.rows, allRows);
        const sparkLabel = `${tile.name}, ${tile.rows.map((r) => `${r.year}: ${pctLabel(r.value)}`).join(", ")}`;
        return (
          <div key={tile.key} className={`forecast-tile is-${tile.key}`}>
            <div className="forecast-tile-head">
              <span className="forecast-tile-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.8} />
              </span>
              <span className="forecast-tile-name">
                {ONS_SERIES[tile.key] ? (
                  <a href={ONS_SERIES[tile.key]} target="_blank" rel="noopener noreferrer" title="ONS series">
                    {tile.name}
                  </a>
                ) : (
                  tile.name
                )}
              </span>
            </div>
            <div className="forecast-tile-body">
              <div>
                <p className="forecast-tile-value">{pctLabel(tile.value)}</p>
                <p className="forecast-tile-sub">growth in {year}</p>
              </div>
              <Sparkline rows={tile.rows} label={sparkLabel} />
            </div>
            {meaning && <p className="forecast-tile-meaning">{meaning}</p>}
          </div>
        );
      })}
    </div>
  );
}

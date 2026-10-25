// Headline forecast figures as tiles: CPI, RPI and earnings growth in the
// first forecast year (2027). Each tile has its full name, then the figure
// with, on its right, a tag that waits for the Budget forecast; once it is published the tile reads
// "March 2.0% → Budget 2.3%" with the change. The definition and source are
// in the section's intro, once.

import { changeClass, forecastName, heroYear, pctLabel, ppWords, toRows } from "../../../utils/livingStandards/forecast";

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
};

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const ICONS = {
  // A price tag
  cpi: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  ),
  // A receipt
  rpi: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}>
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  ),
  // A briefcase
  earnings: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </svg>
  ),
};

export default function ForecastHeadlineSection({ data }) {
  const forecast = data.forecast;
  const published = Boolean(forecast.post_published);
  const year = heroYear(forecast);
  const byKey = {};
  forecast.sections.forEach((s) => s.series.forEach((series) => (byKey[series.key] = series)));

  const tiles = (forecast.headline || [])
    .map((key) => {
      const series = byKey[key];
      if (!series) return null;
      const rows = toRows(series, published);
      const row = rows.find((r) => r.year === year);
      if (!row) return null;
      return { key, name: NAMES[key] ?? series.label, rows, ...row };
    })
    .filter(Boolean);

  if (!tiles.length) return null;
  const pre = forecastName(forecast.pre_label).replace(/^OBR /, "");
  const post = forecastName(forecast.post_label).replace(/^OBR /, "");

  return (
    <div className="forecast-tiles">
      {tiles.map((tile) => (
        <div key={tile.key} className="forecast-tile">
          <div className="forecast-tile-head">
            <span className={`forecast-tile-icon is-${tile.key}`}>{ICONS[tile.key]}</span>
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
              <p className="forecast-tile-value">{pctLabel(published && tile.updated != null ? tile.updated : tile.previous)}</p>
              <p className="forecast-tile-sub">growth in {year}</p>
            </div>
            {published && tile.updated != null ? (
              <p className="forecast-tile-compare">
                {pre} {pctLabel(tile.previous)} → {post} {pctLabel(tile.updated)}{" "}
                <span className={`forecast-tile-delta ${changeClass(tile.shownChange)}`}>
                  {tile.shownChange > 0 ? "▲" : tile.shownChange < 0 ? "▼" : ""} {ppWords(tile.shownChange)}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

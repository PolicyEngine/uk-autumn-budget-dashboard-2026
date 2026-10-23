// Headline forecast figures as tiles. Ported from
// PolicyEngine/uk-living-standards-outlook; text and figures unchanged.

import { HERO_YEAR, changeClass, pctLabel, ppLabel, toRows } from "../../../utils/livingStandards/forecast";
import { ObrSource } from "../sources";

// ONS series pages for the tile names (checked 20 Oct 2026). Earnings is not
// linked: the tile is OBR's calendar-year average earnings growth, and ONS
// KAB9 is a level series, not that growth rate; the tile's source is the OBR.
const ONS_SERIES = {
  cpi: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23",
  rpi: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/czbh/mm23",
};

export default function ForecastHeadlineSection({ data }) {
  const forecast = data.forecast;
  const published = Boolean(forecast.post_published);
  const byKey = {};
  forecast.sections.forEach((s) => s.series.forEach((series) => (byKey[series.key] = series)));

  const cards = (forecast.headline || [])
    .map((key) => {
      const series = byKey[key];
      if (!series) return null;
      const row = toRows(series, published).find((r) => r.year === HERO_YEAR);
      if (!row) return null;
      return { key, label: `${series.label.replace(/ (inflation|growth)$/i, "")} ${HERO_YEAR}`, ...row };
    })
    .filter(Boolean);

  if (!cards.length) return null;

  return (
    <div className="ls-tiles">
      {cards.map((card) => (
        <div key={card.key} className="card ls-tile">
          <div className="ls-tile-label">
            {ONS_SERIES[card.key] ? (
              <a href={ONS_SERIES[card.key]} target="_blank" rel="noopener noreferrer" title="ONS series">
                {card.label}
              </a>
            ) : (
              card.label
            )}
          </div>
          {published ? (
            <>
              <div className="ls-tile-number">
                {pctLabel(card.previous)} &rarr; {pctLabel(card.updated)}
              </div>
              <div className={`ls-tile-sub ${changeClass(card.change)}`}>{ppLabel(card.change)}</div>
            </>
          ) : (
            <>
              <div className="ls-tile-number">{pctLabel(card.previous)}</div>
              <div className="ls-tile-sub">Budget revision pending</div>
            </>
          )}
          <p className="ls-source">
            <ObrSource />
          </p>
        </div>
      ))}
    </div>
  );
}

// Headline forecast figures as tiles: CPI, RPI and earnings growth in 2026,
// and once the Budget forecast is published, both forecasts and the change
// ("2.3% → 2.6%", "+0.3pp"). Their definition and source sit in an "About
// these figures" disclosure, as every chart's do.

import { HERO_YEAR, changeClass, forecastName, pctLabel, ppWords, toRows } from "../../../utils/livingStandards/forecast";
import Disclosure from "../../Disclosure";
import StatTiles from "../../StatTiles";
import { ForecastSource } from "../sources";

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

  const pre = forecastName(forecast.pre_label);
  const about = published
    ? `Calendar-year growth in the annual average: ${pre} (pre-Budget), then the ${forecastName(forecast.post_label)} forecast, and the change in percentage points.`
    : `Calendar-year growth in the annual average, ${pre} forecast.`;

  return (
    <StatTiles
      items={cards.map((card) => ({
        key: card.key,
        value: published ? `${pctLabel(card.previous)} → ${pctLabel(card.updated)}` : pctLabel(card.previous),
        label: ONS_SERIES[card.key] ? (
          <a href={ONS_SERIES[card.key]} target="_blank" rel="noopener noreferrer" title="ONS series">
            {card.label}
          </a>
        ) : (
          card.label
        ),
        sub: published ? ppWords(card.shownChange) : null,
        subClassName: changeClass(card.shownChange),
      }))}
      footer={
        <Disclosure inCard title="About these figures">
          <p>{about}</p>
          <p className="ls-source">
            <ForecastSource forecast={forecast} />
          </p>
        </Disclosure>
      }
    />
  );
}

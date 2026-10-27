// The forecast at a glance: one tile per headline series (forecast.headline:
// CPI, RPI, earnings). Each has an icon, the series' name, its growth in
// the first forecast year as a big figure, a small trend of the forecast
// years (HeadlineTile), and one plain line on what it means
// (forecastWords.tileMeaning), which never repeats the figure. The basis and source are in the panel's
// intro, once. The Budget-day forecast is held (ForecastPanel), so a tile
// shows the one published forecast.

import { Briefcase, Coins, House, KeyRound, Percent, Receipt, Tag } from "lucide-react";
import { heroYear, pctLabel, toRows } from "../../../utils/livingStandards/forecast";
import { tileMeaning } from "../../../utils/livingStandards/forecastWords";
import HeadlineTile from "../HeadlineTile";

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
      {tiles.map((tile) => (
        <HeadlineTile
          key={tile.key}
          icon={ICONS[tile.key] ?? Tag}
          name={tile.name}
          href={ONS_SERIES[tile.key]}
          hrefTip={ONS_SERIES[tile.key] && "The ONS series this measures"}
          value={pctLabel(tile.value)}
          caption={`annual growth, ${year}`}
          trend={{
            rows: tile.rows.map((r) => ({ label: r.year, value: r.value })),
            format: pctLabel,
            seriesLabel: "OBR forecast",
            highlight: year,
            minSpan: 1,
          }}
          meaning={tileMeaning(tile.key, tile.rows, allRows)}
        />
      ))}
    </div>
  );
}

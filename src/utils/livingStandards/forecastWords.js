// The Forecast changes sub-tab's words: short names for the forecast series,
// the cards each group of series is drawn in, and the one plain sentence
// each tile and card carries. Every number comes from the outlook's
// forecast series (in percent, as toRows gives them), rounded as shown.

import { formatOneDp, round1 } from "./outlook";

/** Short names for legends, table columns and sentences. */
export const SERIES_NAMES = {
  cpi: "CPI",
  cpih: "CPIH",
  cpi_ahc: "CPI after housing costs",
  rpi: "RPI",
  earnings: "Average earnings",
  non_labour_income: "Non-labour income",
  house_prices: "House prices",
  rent: "Rents",
  social_rent: "Social rent cap",
  mortgage_interest: "Mortgage interest",
};

export const seriesName = (series) => SERIES_NAMES[series.key] ?? series.label;

/**
 * The page's groups, matched to the data's sections by title, each with
 * its heading and the cards its series are drawn in. Series with very
 * different scales get their own card (mortgage interest, at about 10% in
 * 2027, would flatten rents and house prices on one axis). A series the
 * config does not name gets a card of its own.
 */
export const FORECAST_GROUPS = [
  {
    section: "Inflation and price indices",
    title: "Prices: what your money buys",
    icon: "tag",
    subtitle: "How fast prices rise. Most benefits rise each April with CPI.",
    cards: [{ id: "prices", title: "Inflation measures", icon: "tag", keys: ["cpi", "cpih", "cpi_ahc", "rpi"] }],
  },
  {
    section: "Income and earnings",
    title: "Pay and other income",
    icon: "briefcase",
    subtitle: "How fast pay and other income grow, before prices are taken into account.",
    cards: [{ id: "income", title: "Earnings and other income", icon: "briefcase", keys: ["earnings", "non_labour_income"] }],
  },
  {
    section: "Housing and rent",
    title: "Housing costs",
    icon: "house",
    subtitle: "How fast rents, house prices and mortgage interest bills grow.",
    cards: [
      { id: "homes", title: "House prices and rents", icon: "house", keys: ["house_prices", "rent", "social_rent"] },
      { id: "mortgage", title: "Mortgage interest payments", icon: "percent", keys: ["mortgage_interest"] },
    ],
  },
];

const pct = (v) => `${formatOneDp(v)}%`;
const points = (v) => {
  const r = Math.abs(round1(v));
  return `${formatOneDp(r)} ${r === 1 ? "point" : "points"}`;
};
const values = (rows) => rows.map((r) => r.value).filter((v) => v != null);
const first = (rows) => rows.find((r) => r.value != null);
const last = (rows) => [...rows].reverse().find((r) => r.value != null);

/** "eases", "rises" or "holds", from the first to the last shown value. */
function direction(rows) {
  const a = round1(first(rows)?.value);
  const b = round1(last(rows)?.value);
  if (a == null || b == null || a === b) return "holds";
  return b < a ? "eases" : "rises";
}

/** The range of a set of shown values: "2.3% to 3.0%", or "2.0%" if all equal. */
function range(vals) {
  const lo = Math.min(...vals.map(round1));
  const hi = Math.max(...vals.map(round1));
  return lo === hi ? pct(lo) : `${pct(lo)} to ${pct(hi)}`;
}

/**
 * The tile's meaning: one line under its figure for the first year, which
 * the line does not repeat. `rows` is [{ year, value }]; `byKey` holds the
 * other series' rows, for comparisons.
 */
export function tileMeaning(key, rows, byKey = {}) {
  const start = first(rows);
  const end = last(rows);
  if (!start || !end) return null;
  const cpi = byKey.cpi && byKey.cpi.find((r) => r.year === start.year)?.value;
  if (key === "cpi") {
    if (direction(rows) === "holds" && new Set(values(rows).map(round1)).size === 1) {
      return round1(start.value) === 2
        ? `Holds at this rate to ${end.year}, in line with the 2% inflation target.`
        : `Holds at this rate to ${end.year}.`;
    }
  }
  if (key === "earnings" && cpi != null) {
    const gap = round1(start.value) - round1(cpi);
    if (gap > 0) return `Pay outpaces CPI prices by ${points(gap)} in ${start.year}, so average real earnings rise.`;
    if (gap < 0) return `Pay lags CPI prices by ${points(gap)} in ${start.year}, so average real earnings fall.`;
    return `Pay keeps pace with CPI prices in ${start.year}, so average real earnings hold.`;
  }
  if (key === "rpi" && cpi != null) {
    const gap = round1(start.value) - round1(cpi);
    const lead = gap === 0 ? "Matches CPI" : `Runs ${points(gap)} ${gap > 0 ? "above" : "below"} CPI`;
    const verb = direction(rows);
    return `${lead} in ${start.year}; ${verb === "holds" ? `holds to ${end.year}` : `${verb} to ${pct(end.value)} by ${end.year}`}.`;
  }
  const verb = direction(rows);
  return verb === "holds" ? `Holds at this rate to ${end.year}.` : `Then ${verb} to ${pct(end.value)} by ${end.year}.`;
}

/**
 * A card's one sentence, leading with its finding. `series` maps each of
 * the card's keys to its rows ([{ year, value }]).
 */
export function cardSentence(id, series) {
  const s = series;
  if (id === "prices" && s.cpi && s.rpi) {
    const gaps = s.rpi.map((r, i) => (r.value != null && s.cpi[i]?.value != null ? round1(r.value) - round1(s.cpi[i].value) : null)).filter((g) => g != null);
    if (gaps.length && gaps.every((g) => g > 0)) {
      const others = ["cpih", "cpi_ahc"].filter((k) => s[k]).map((k) => SERIES_NAMES[k]);
      const tail = others.length ? `; ${others.join(" and ")} stay close to CPI.` : ".";
      return `RPI runs ${range(gaps).replace(/%/g, "")} points above CPI each year${tail}`;
    }
  }
  if (id === "income" && s.earnings && s.non_labour_income) {
    const gaps = s.non_labour_income.map((r, i) => ({ year: r.year, gap: round1(r.value) - round1(s.earnings[i]?.value) })).filter((g) => !Number.isNaN(g.gap));
    if (gaps.length && gaps.every((g) => g.gap > 0)) {
      const widest = gaps.reduce((a, b) => (b.gap > a.gap ? b : a));
      return `Non-labour income grows faster than average earnings every year, by ${points(widest.gap)} in ${widest.year}.`;
    }
  }
  if (id === "homes" && s.house_prices && s.rent) {
    const verb = direction(s.house_prices);
    const homes = verb === "holds" ? `House price growth holds at ${pct(first(s.house_prices).value)}` : `House price growth ${verb} from ${pct(first(s.house_prices).value)} to ${pct(last(s.house_prices).value)} by ${last(s.house_prices).year}`;
    return `${homes}; rents grow ${range(values(s.rent))} a year.`;
  }
  if (id === "mortgage" && s.mortgage_interest) {
    const rows = s.mortgage_interest.filter((r) => r.value != null);
    if (rows.length > 1) {
      return `Mortgage interest payments rise ${pct(rows[0].value)} in ${rows[0].year}, then ${range(values(rows.slice(1)))} a year.`;
    }
  }
  // Any other card: its first series, first and last years
  const [key, rows] = Object.entries(s)[0] ?? [];
  const a = rows && first(rows);
  const b = rows && last(rows);
  if (!a || !b || a === b) return null;
  return `${SERIES_NAMES[key] ?? "This series"} grows ${pct(a.value)} in ${a.year} and ${pct(b.value)} in ${b.year}.`;
}

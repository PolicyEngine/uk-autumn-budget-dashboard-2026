/**
 * Rank constituencies by average change in household net income and export
 * the full ranked list as CSV.
 *
 * Ported from PR #11 (Max Ghenis) to the published results by area: each
 * constituency has one published row per outcome, and only a row with a
 * figure (reported or approximate) is ranked. A withheld seat, or one with
 * no row, has no rank, and is listed in the CSV without a figure.
 */

import { lookupRow } from "./geography/rows";
import { regionForBoundary } from "./geography/regions";
import { seatCode } from "./geography/seats";

/**
 * The two rankings: by £ per household (`average_change`) or by share of
 * baseline income (`relative_change`, a ratio: 0.0123 is 1.23%).
 */
export const RANK_METRICS = Object.freeze({
  gbp: Object.freeze({ field: "average_gain", outcome: "average_change" }),
  pct: Object.freeze({ field: "relative_change", outcome: "relative_change" }),
});

const nameCollator = new Intl.Collator("en-GB");

const hasFigure = (row) => row != null && row.tier !== "withheld" && row.value !== "";

/**
 * One entry per constituency on the map, for a reform and year: its code,
 * name, region and country (from the boundary file), and per outcome the
 * published row (`rows`) and its figure as a number (`average_gain`,
 * `relative_change`), or null when it has none.
 */
export function rankingEntries(features, table, { reform, year }) {
  if (!features || !table || !reform) return [];
  return features.map((feature) => {
    const code = seatCode(feature);
    const rows = {};
    const figures = {};
    for (const { field, outcome } of Object.values(RANK_METRICS)) {
      const row = lookupRow(table, { areaCode: code, reform, year, outcome });
      rows[outcome] = row;
      figures[field] = hasFigure(row) ? Number(row.value) : null;
    }
    const region = regionForBoundary(feature.properties);
    return {
      constituency_code: code,
      constituency_name:
        rows.average_change?.areaName ??
        rows.relative_change?.areaName ??
        feature.properties?.Name ??
        code,
      region: region?.name ?? "",
      country: feature.properties?.Country ?? "",
      rows,
      ...figures,
    };
  });
}

/**
 * Total order used for every ranking: value high to low, then name A to Z,
 * then code. Codes are unique, so no two constituencies compare equal and the
 * order never depends on input order.
 */
function compareDescending(field) {
  return (a, b) =>
    b[field] - a[field] ||
    nameCollator.compare(a.constituency_name, b.constituency_name) ||
    (a.constituency_code < b.constituency_code ? -1 : 1);
}

/**
 * Sort the constituencies with a figure for one metric, highest first, with
 * standard competition ranks: a constituency's rank is one plus the number
 * of constituencies with a strictly higher value, so exact ties share a
 * rank (1, 2, 2, 4). Constituencies without a figure are left out.
 *
 * @param {Array<object>} entries
 * @param {"gbp"|"pct"} metric
 * @returns {Array<object>} copies of the ranked entries with `rank` and `tied`
 */
export function rankConstituencies(entries, metric) {
  const { field } = RANK_METRICS[metric];
  const sorted = entries
    .filter((entry) => Number.isFinite(entry[field]))
    .sort(compareDescending(field));

  const ranked = sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i][field] === ranked[i - 1][field]) {
      ranked[i].rank = ranked[i - 1].rank;
    }
  }
  return ranked.map((entry, index) => ({
    ...entry,
    tied:
      (index > 0 && ranked[index - 1].rank === entry.rank) ||
      (index < ranked.length - 1 && ranked[index + 1].rank === entry.rank),
  }));
}

/**
 * Split a ranked list into its top n and bottom n. Both come from the one
 * total order, so they never share a constituency; with at least 2n
 * constituencies each holds exactly n. The bottom list runs lowest first,
 * with tied constituencies kept in name order.
 *
 * When a cut falls inside a group of tied constituencies, `topTie` or
 * `bottomTie` reports the group (its rank, its size and how many of it the
 * list shows), so the table can say that the rest of the group is not shown.
 */
export function selectTopAndBottom(ranked, n = 10) {
  const top = ranked.slice(0, Math.min(n, ranked.length));
  const bottomCount = Math.min(n, ranked.length - top.length);
  const bottomStart = ranked.length - bottomCount;
  const bottom = ranked.slice(bottomStart).sort((a, b) => b.rank - a.rank);

  const tieAcrossCut = (list, outside) => {
    if (!list.length || !outside) return null;
    const rank = outside.rank;
    const shown = list.filter((e) => e.rank === rank).length;
    if (!shown) return null;
    const total = ranked.filter((e) => e.rank === rank).length;
    return { rank, total, shown };
  };

  return {
    top,
    bottom,
    topTie: tieAcrossCut(top, ranked[top.length]),
    bottomTie: tieAcrossCut(bottom, ranked[bottomStart - 1]),
  };
}

/** True when every constituency has the same value, so no ranking exists. */
export function isAllTied(ranked) {
  return ranked.length > 1 && ranked.every((e) => e.rank === 1);
}

/**
 * Describe a top or bottom list by the signs of its values, so a list of
 * smallest losses is never read as the largest gains.
 */
export function describeList(rows, metric, position) {
  const { field } = RANK_METRICS[metric];
  const values = rows.map((row) => row[field]);
  if (values.length && values.every((v) => v > 0)) {
    return position === "top" ? "Largest gains" : "Smallest gains";
  }
  if (values.length && values.every((v) => v < 0)) {
    return position === "top" ? "Smallest losses" : "Largest losses";
  }
  return position === "top"
    ? "Highest average change"
    : "Lowest average change";
}

// Quote a CSV field when it holds a comma, quote or line break (RFC 4180).
function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const RANKING_CSV_COLUMNS = Object.freeze([
  "rank_by_gbp",
  "rank_by_pct",
  "constituency_code",
  "constituency_name",
  "region",
  "country",
  "average_change_gbp",
  "average_change_gbp_lo",
  "average_change_gbp_hi",
  "average_change_tier",
  "relative_change_ratio",
  "relative_change_ratio_lo",
  "relative_change_ratio_hi",
  "relative_change_tier",
  "year",
  "year_label",
  "measures",
]);

// A row's published figure and interval, exactly as published; blank for a
// withheld row or none.
const published = (row) =>
  hasFigure(row) ? [row.value, row.lo, row.hi, row.tier] : ["", "", "", row?.tier ?? ""];

/**
 * Build the full ranked list as CSV: one header line and one line per
 * constituency. Ranked constituencies come first, in the order of the
 * chosen metric; those without a figure for it follow in name order. Both
 * ranks are included (blank where a seat has no figure), so the file can
 * be re-sorted either way. Figures and intervals are the published strings,
 * unrounded; ranks use their values.
 *
 * @param {Array<object>} entries - from rankingEntries
 * @param {object} options
 * @param {"gbp"|"pct"} options.metric - sort order of the rows
 * @param {number} options.year - model year, as in the published file
 * @param {string} options.yearLabel - the year as the dashboard shows it
 * @param {string[]} options.measures - the measures in the figures
 * @param {boolean} [options.mock] - label every row as MOCK data
 */
export function buildRankingCsv(
  entries,
  { metric, year, yearLabel, measures, mock = false },
) {
  const rankOf = (m) =>
    new Map(rankConstituencies(entries, m).map((e) => [e.constituency_code, e.rank]));
  const rankByGbp = rankOf("gbp");
  const rankByPct = rankOf("pct");
  const ranked = rankConstituencies(entries, metric);
  const rankedCodes = new Set(ranked.map((e) => e.constituency_code));
  const unranked = entries
    .filter((e) => !rankedCodes.has(e.constituency_code))
    .sort(
      (a, b) =>
        nameCollator.compare(a.constituency_name, b.constituency_name) ||
        (a.constituency_code < b.constituency_code ? -1 : 1),
    );
  const measureList = measures.join("; ");

  const header = mock ? ["data_status", ...RANKING_CSV_COLUMNS] : RANKING_CSV_COLUMNS;
  const lines = [header.join(",")];
  for (const entry of [...ranked, ...unranked]) {
    const fields = [
      rankByGbp.get(entry.constituency_code) ?? "",
      rankByPct.get(entry.constituency_code) ?? "",
      entry.constituency_code,
      entry.constituency_name,
      entry.region,
      entry.country,
      ...published(entry.rows?.average_change),
      ...published(entry.rows?.relative_change),
      year,
      yearLabel,
      measureList,
    ];
    lines.push((mock ? ["MOCK", ...fields] : fields).map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

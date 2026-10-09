/**
 * Rank constituencies by average change in household net income and export
 * the full ranked list as CSV.
 */

export const RANK_METRICS = {
  gbp: { field: "average_gain", label: "£ per household" },
  pct: { field: "relative_change", label: "% of income" },
};

const nameCollator = new Intl.Collator("en-GB");

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
 * Sort constituencies by one metric, highest first, with standard competition
 * ranks: a constituency's rank is one plus the number of constituencies with a
 * strictly higher value, so exact ties share a rank (1, 2, 2, 4).
 *
 * @param {Array<object>} entries - aggregated constituency results
 * @param {"gbp"|"pct"} metric
 * @returns {Array<object>} copies of the entries with `rank` and `tied`
 */
export function rankConstituencies(entries, metric) {
  const { field } = RANK_METRICS[metric];
  const sorted = [...entries].sort(compareDescending(field));

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
 * smallest losses is never read as the biggest winners.
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
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Fixed decimals without a "-0.00" for values that round to zero.
function fixed(value, digits) {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

export const RANKING_CSV_COLUMNS = [
  "rank_by_gbp",
  "rank_by_pct",
  "constituency_code",
  "constituency_name",
  "region",
  "country",
  "average_change_gbp",
  "relative_change_pct",
  "year",
  "year_label",
  "policies",
];

/**
 * Build the full ranked list as CSV: one header line and one line per
 * constituency, sorted by the chosen metric. Both ranks are included, so the
 * file can be re-sorted either way. Pounds are rounded to pence and
 * percentages to four decimal places; ranks use the unrounded values.
 *
 * @param {Array<object>} entries - aggregated constituency results
 * @param {object} options
 * @param {"gbp"|"pct"} options.metric - sort order of the rows
 * @param {Map<string, {region: string, country: string}>} options.regionLookup
 * @param {number} options.year - model year, as in constituency.csv
 * @param {string} options.yearLabel - the year as the dashboard shows it
 * @param {string[]} options.policies - reform IDs summed into each value
 * @param {boolean} [options.mock] - label every row as MOCK data
 */
export function buildRankingCsv(
  entries,
  { metric, regionLookup, year, yearLabel, policies, mock = false },
) {
  const rankByGbp = new Map(
    rankConstituencies(entries, "gbp").map((e) => [
      e.constituency_code,
      e.rank,
    ]),
  );
  const rankByPct = new Map(
    rankConstituencies(entries, "pct").map((e) => [
      e.constituency_code,
      e.rank,
    ]),
  );
  const policyList = policies.join(";");

  const header = mock
    ? ["data_status", ...RANKING_CSV_COLUMNS]
    : RANKING_CSV_COLUMNS;
  const lines = [header.join(",")];
  for (const entry of rankConstituencies(entries, metric)) {
    const place = regionLookup.get(entry.constituency_code) ?? {};
    const fields = [
      rankByGbp.get(entry.constituency_code),
      rankByPct.get(entry.constituency_code),
      entry.constituency_code,
      entry.constituency_name,
      place.region ?? "",
      place.country ?? "",
      fixed(entry.average_gain, 2),
      fixed(entry.relative_change, 4),
      year,
      yearLabel,
      policyList,
    ];
    lines.push((mock ? ["MOCK", ...fields] : fields).map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

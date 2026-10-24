/**
 * Results by age band (each verified artifact's age_impact.csv) for the "Young people"
 * section: the rows the charts and headline figures read, for the selected
 * policies and year.
 *
 * Each row's mean change gives every person their household's change in
 * net income (not equivalised) and averages over people. Mean changes are
 * added up across the selected policies, as the other charts on the page
 * add up each policy's own effect. Shares of people better or worse off,
 * and counts of people directly affected, cannot be added up, so they come
 * from a single policy's row or, with every policy selected, from the
 * combined run; any other selection has none.
 */

/** The age bands, in order, with a label for the page and a short one. */
export const AGE_BANDS = [
  { key: "0-15", label: "Under 16", short: "<16" },
  { key: "16-24", label: "16 to 24", short: "16–24" },
  { key: "25-34", label: "25 to 34", short: "25–34" },
  { key: "35-49", label: "35 to 49", short: "35–49" },
  { key: "50-64", label: "50 to 64", short: "50–64" },
  { key: "65+", label: "65 and over", short: "65+" },
];
export const YOUNG_BAND = "16-24";
export const ALL_BAND = "all";

/** A band with fewer survey records than this is not shown. */
export const MIN_SAMPLE_SIZE = 100;

const forYear = (rows, year) => rows.filter((row) => row.year === Number(year));

/** Whether any row covers the year. */
export const isPublished = (rows, year) => forYear(rows ?? [], year).length > 0;

/**
 * One point per age band: each selected policy's mean change (keyed by its
 * namespaced id), the net change, and whether the band is too thin to show.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string, name: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 */
export function meanChangeByBand(rows, policies, selected, year) {
  const yearRows = forYear(rows ?? [], year);
  return AGE_BANDS.map((band) => {
    const point = { band: band.key, label: band.label, short: band.short };
    let net = 0;
    let suppressed = false;
    let incomplete = selected.some((id) => !policies.some((policy) => policy.id === id));
    for (const policy of policies) {
      const isSelected = selected.includes(policy.id);
      const row = isSelected
        ? yearRows.find((r) => r.reform_id === policy.id && r.age_band === band.key)
        : null;
      if (row && row.sample_size < MIN_SAMPLE_SIZE) suppressed = true;
      const value = row && Number.isFinite(row.mean_change) ? row.mean_change : null;
      if (isSelected && value === null) incomplete = true;
      point[policy.seriesKey ?? `measure:${policy.id}`] = value;
      if (value !== null) net += value;
    }
    point.netChange = incomplete ? null : net;
    point.incomplete = incomplete;
    point.suppressed = suppressed;
    if (suppressed) {
      for (const policy of policies) point[policy.seriesKey ?? `measure:${policy.id}`] = null;
      point.netChange = null;
    }
    return point;
  });
}

/**
 * The run whose rows hold non-additive statistics for this selection: the
 * policy's own run when one is selected, the package's combined run
 * (`combinedId`, the catalogue's) when every displayable measure is, else
 * null. A held measure is never part of the package.
 */
export function wholeSelectionRun(policies, selected, combinedId = null) {
  const offered = policies.filter((policy) => policy.displayable !== false);
  if (selected.length === 1) {
    return offered.some((policy) => policy.id === selected[0]) ? selected[0] : null;
  }
  if (selected.length > 1 && selected.length === offered.length && offered.every((policy) => selected.includes(policy.id))) {
    return combinedId ?? null;
  }
  return null;
}

/**
 * Rows for people aged 16 to 24 and for all people from the whole
 * selection's run, or null when the selection has no such run or its
 * rows are missing or too thin.
 */
export function youngAndAll(rows, policies, selected, year, combinedId) {
  const run = wholeSelectionRun(policies, selected, combinedId ?? null);
  if (!run) return null;
  const yearRows = forYear(rows ?? [], year).filter((row) => row.reform_id === run);
  const young = yearRows.find((row) => row.age_band === YOUNG_BAND);
  const all = yearRows.find((row) => row.age_band === ALL_BAND);
  if (!young || !all) return null;
  if (young.sample_size < MIN_SAMPLE_SIZE) return null;
  return { run, young, all };
}

/** People aged 16 to 24 in the year (the same in every run), or null. */
export function youngPopulation(rows, year) {
  const row = forYear(rows ?? [], year).find((r) => r.age_band === YOUNG_BAND);
  return row ? row.people : null;
}

/** 7,471,170 -> "7.5m"; 820,000 -> "820k". */
export function formatPeople(value) {
  if (value === null || value === undefined) return "–";
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
  if (value >= 1e3) return `${Math.round(value / 1e3).toLocaleString("en-GB")}k`;
  return Math.round(value).toLocaleString("en-GB");
}

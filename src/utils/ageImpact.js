/**
 * Results by age (public/data/age_impact.csv) for the "Young people"
 * section: the rows the charts read, for the selected policies and year.
 * The file has a row per age band, one for all ages ("all"), and one per
 * single year of age ("0" to "89", then "90+").
 *
 * Each row's mean change gives every person their household's change in
 * net income (not equivalised) and averages over people. Mean changes are
 * added up across the selected policies, as the other charts on the page
 * add up each policy's own effect. Shares of people better or worse off,
 * and counts of people directly affected, cannot be added up, so they come
 * from a single policy's row or, with every policy selected, from the
 * combined run; any other selection has none.
 */
import { COMBINED_REFORM_ID } from "./policyConfig";

/**
 * The age bands, in order, with a label for the page and a short one: the
 * ONS Labour Force Survey's age groups (16 to 24 is the ONS's young people),
 * with children under 16, as in ONS and DWP HBAI statistics.
 */
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
/** Every band and all ages: the groups the comparison charts offer. */
export const AGE_GROUPS = [
  ...AGE_BANDS,
  { key: ALL_BAND, label: "All ages", short: "All" },
];
/** The top single year of age: its row is everyone that age or older. */
export const SINGLE_AGE_TOP = 90;
/** The single-year row label of an age ("17", or "90+" at the top). */
export const singleAgeKey = (age) => (age >= SINGLE_AGE_TOP ? `${SINGLE_AGE_TOP}+` : String(age));
/** The ONS source of the age bands, for the Methodology. */
export const AGE_BAND_SOURCE = {
  label: "ONS, A05 SA: Employment, unemployment and economic inactivity by age group",
  url: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/datasets/employmentunemploymentandeconomicinactivitybyagegroupseasonallyadjusteda05sa",
};

/** A band with fewer survey records than this is not shown. */
export const MIN_SAMPLE_SIZE = 100;

const forYear = (rows, year) => rows.filter((row) => row.year === Number(year));

/** Whether any row covers the year. */
export const isPublished = (rows, year) => forYear(rows ?? [], year).length > 0;

/**
 * One point per age band: each selected policy's mean change (keyed by its
 * name), the net change, and whether the band is too thin to show.
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
    for (const policy of policies) {
      const row = selected.includes(policy.id)
        ? yearRows.find((r) => r.reform_id === policy.id && r.age_band === band.key)
        : null;
      if (row && row.sample_size < MIN_SAMPLE_SIZE) suppressed = true;
      const value = row ? row.mean_change : 0;
      point[policy.name] = value;
      net += value;
    }
    point.netChange = net;
    point.suppressed = suppressed;
    if (suppressed) {
      for (const policy of policies) point[policy.name] = 0;
      point.netChange = null;
    }
    return point;
  });
}

/**
 * The run whose rows hold non-additive statistics for this selection: the
 * policy's own run when one is selected, the combined run when all are,
 * else null.
 */
export function wholeSelectionRun(policies, selected) {
  if (selected.length === 1) return selected[0];
  if (selected.length > 1 && policies.every((policy) => selected.includes(policy.id))) {
    return COMBINED_REFORM_ID;
  }
  return null;
}

/**
 * One point per single year of age, 0 to SINGLE_AGE_TOP: the selected
 * policies' mean changes added up (`netChange`), or null where any selected
 * policy has no row for the age (the generator leaves out an age with too
 * few survey records) or a thin one.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 */
export function meanChangeBySingleAge(rows, policies, selected, year) {
  const byKey = new Map();
  for (const row of forYear(rows ?? [], year)) byKey.set(`${row.reform_id}|${row.age_band}`, row);
  const chosen = policies.filter((policy) => selected.includes(policy.id));
  const points = [];
  for (let age = 0; age <= SINGLE_AGE_TOP; age += 1) {
    const key = singleAgeKey(age);
    let net = 0;
    let complete = chosen.length > 0;
    for (const policy of chosen) {
      const row = byKey.get(`${policy.id}|${key}`);
      if (!row || row.sample_size < MIN_SAMPLE_SIZE) {
        complete = false;
        break;
      }
      net += row.mean_change;
    }
    points.push({ age, label: key, netChange: complete ? net : null });
  }
  return points;
}

/**
 * The whole selection's run's row for every age group (AGE_GROUPS, in
 * order): `{ run, groups: [{ key, label, row, suppressed }] }`, or null
 * when the selection has no such run or the year has no rows for it. A
 * group whose row is missing or too thin has `row: null` and
 * `suppressed: true`.
 */
export function sharesByGroup(rows, policies, selected, year) {
  const run = wholeSelectionRun(policies, selected);
  if (!run) return null;
  const yearRows = forYear(rows ?? [], year).filter((row) => row.reform_id === run);
  if (!yearRows.length) return null;
  const groups = AGE_GROUPS.map((group) => {
    const row = yearRows.find((candidate) => candidate.age_band === group.key) ?? null;
    const usable = row && row.sample_size >= MIN_SAMPLE_SIZE ? row : null;
    return { key: group.key, label: group.label, short: group.short, row: usable, suppressed: !usable };
  });
  return { run, groups };
}

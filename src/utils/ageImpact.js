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
 * The package run to read in a year: `packageRun` (the published combined
 * run of exactly the selection, selectionPackageKey) when the rows hold it
 * for the year, else null.
 */
export function packageRunFor(rows, packageRun, year) {
  if (!packageRun) return null;
  return (rows ?? []).some((row) => row.reform_id === packageRun && row.year === Number(year)) ? packageRun : null;
}

/** The notice for several policies whose results by age are not published together. */
export const COMBINATION_NOT_PUBLISHED = "Results by age for this combination of policies are not published yet.";

/** Why a package's chart has its net but no policy parts. */
export const PACKAGE_NET_ONLY =
  "The net change is all the selected policies together. Each policy's part is not shown, as a selected policy has too few survey records by age.";

/** "A", "A and B", "A, B and C". */
export const listNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);
const haveOrHas = (names) => (names.length > 1 ? "have" : "has");

/**
 * Why no policy's part is drawn when some are thin: the package's net is
 * shown, so the other policies' parts beside it would give the thin
 * policies' part back by difference (never revealed by subtraction).
 */
const BY_DIFFERENCE = "showing only the other policies would let the withheld policies' part be worked out from the net change";

/**
 * Why no policy's part is shown, naming the thin policies: one sentence in
 * About this chart's caveats (the Show choice is then not offered at all).
 * `where` is the breakdown ("at some ages", "in some age groups").
 */
export const withheldPartsCaveat = (names, where = "at some ages") =>
  names.length
    ? `The split by policy is not shown for this selection: ${listNames(names)} ${haveOrHas(names)} too few survey records ${where}, so the other policies' parts would reveal ${names.length > 1 ? "theirs" : "its part"}.`
    : `The split by policy is not shown for this selection: a selected policy has too few survey records ${where}, so the other policies' parts would reveal its part.`;

/** About this chart's caveat when a package's chart shows no policy parts. */
export const PACKAGE_PARTS_CAVEAT = withheldPartsCaveat([]);

/** PACKAGE_NET_ONLY, naming the thin policies. */
export const withheldNetOnly = (names) =>
  names.length
    ? `The net change is all the selected policies together. Each policy's part is not shown, as ${listNames(names)} ${haveOrHas(names)} too few survey records by age, and ${BY_DIFFERENCE}.`
    : PACKAGE_NET_ONLY;

/**
 * The selected policies (shown ones only) with no usable row at one of
 * `labels` (age_band values) in one of `years` that the rows cover: the
 * policies that withhold their rows by age there.
 */
export function policiesWithoutRows(rows, policies, selected, years, labels) {
  const covered = years.map(Number).filter((year) => (rows ?? []).some((row) => row.year === year));
  const usable = new Set(
    (rows ?? []).filter((row) => usableRow(row)).map((row) => `${row.reform_id}|${row.year}|${row.age_band}`),
  );
  return policies.filter(
    (policy) =>
      selected.includes(policy.id) &&
      policy.displayable !== false &&
      covered.some((year) => labels.some((label) => !usable.has(`${policy.id}|${year}|${label}`))),
  );
}

const usableRow = (row) => Boolean(row) && row.sample_size >= MIN_SAMPLE_SIZE && Number.isFinite(row.mean_change);

const seriesKeyOf = (policy) => policy.seriesKey ?? `measure:${policy.id}`;

/**
 * The selection rule for a chart of points (one per band or single age)
 * whose `netChange` sums the selected policies' own rows:
 *
 * - a published package (`run`): `netChange` is the package's own row; each
 *   policy's part stays only when every point has every part (`partsShown`),
 *   so a stack never sits under a net it does not add up to;
 * - several policies and no package: when any point lacks a member's row,
 *   every point is null and `combinationUnavailable` (never half drawn);
 * - one policy: its own rows, a missing point said as missing.
 */
function applySelectionRule(points, { rows, policies, selected, year, run, keyOf }) {
  if (run) {
    const yearRows = forYear(rows ?? [], year).filter((row) => row.reform_id === run);
    const partsShown = points.every((point) => point.netChange !== null && point.netChange !== undefined);
    return points.map((point) => {
      const row = yearRows.find((each) => each.age_band === keyOf(point));
      const usable = usableRow(row);
      const next = { ...point, incomplete: false, suppressed: !usable, netChange: usable ? row.mean_change : null, fromPackage: true, partsShown };
      if (!partsShown || !usable) {
        for (const policy of policies) next[seriesKeyOf(policy)] = null;
        if (next.parts) next.parts = [];
      }
      return next;
    });
  }
  if (new Set(selected).size > 1 && points.some((point) => point.netChange === null || point.netChange === undefined)) {
    return points.map((point) => {
      const next = { ...point, incomplete: false, suppressed: false, netChange: null, combinationUnavailable: true };
      for (const policy of policies) next[seriesKeyOf(policy)] = null;
      if (next.parts) next.parts = [];
      return next;
    });
  }
  return points;
}

/**
 * One point per age band: each selected policy's mean change (keyed by its
 * namespaced id), the net change, and whether the band is too thin to show.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string, name: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 * @param {string|null} [packageRun] - The published combined run of exactly
 *   the selection, read under the selection rule (applySelectionRule)
 */
export function meanChangeByBand(rows, policies, selected, year, packageRun = null) {
  const points = sumByBand(rows, policies, selected, year);
  const run = packageRunFor(rows, packageRun, year);
  return applySelectionRule(points, { rows, policies, selected, year, run, keyOf: (point) => point.band });
}

/**
 * meanChangeByBand's points for any list of single-year points
 * (`{ label, netChange, parts }`, keyed by the age's row label): the same
 * selection rule.
 */
export function singleAgeSelection(points, { rows, policies, selected, year, packageRun = null }) {
  const run = packageRunFor(rows, packageRun, year);
  return applySelectionRule(points, { rows, policies, selected, year, run, keyOf: (point) => point.label });
}

function sumByBand(rows, policies, selected, year) {
  const yearRows = forYear(rows ?? [], year);
  return AGE_BANDS.map((band) => {
    const point = { band: band.key, label: band.label, short: band.short };
    let net = 0;
    let suppressed = false;
    let incomplete = selected.some((id) => !policies.some((policy) => policy.id === id && policy.displayable !== false));
    for (const policy of policies) {
      const isSelected = selected.includes(policy.id);
      const row = isSelected && policy.displayable !== false
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
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  const points = [];
  for (let age = 0; age <= SINGLE_AGE_TOP; age += 1) {
    const key = singleAgeKey(age);
    let net = 0;
    let complete = chosen.length > 0 && chosen.length === selected.length;
    for (const policy of chosen) {
      const row = byKey.get(`${policy.id}|${key}`);
      if (!row || row.sample_size < MIN_SAMPLE_SIZE || !Number.isFinite(row.mean_change)) {
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
export function sharesByGroup(rows, policies, selected, year, combinedId = null) {
  const run = wholeSelectionRun(policies, selected, combinedId);
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

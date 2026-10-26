/**
 * Data for the Pensioners sub-tab: people at or over State Pension age,
 * from the single years of age in public/data/age_impact.csv.
 *
 * State Pension age rises from 66 to 67 between April 2026 and March 2028
 * (Pensions Act 2014, s.26). The file has whole years of age, so a
 * pensioner here is everyone at or over the age most of whose people have
 * reached State Pension age by the middle of the year: 66 and over in
 * 2026-27, 67 and over from 2027-28 (pensionerAge).
 *
 * Each single age is a separate row of the same run, so the pensioners'
 * figures are those rows weighted by people: the mean change, and the
 * shares better off, unchanged and worse off, are exact for the group. A
 * group with a missing or thin age (under MIN_SAMPLE_SIZE records) is null,
 * never a partial sum. Mean changes are added up across the selected
 * policies, as on the rest of the page; shares come from one run only
 * (wholeSelectionRun).
 */
import {
  ALL_BAND,
  MIN_SAMPLE_SIZE,
  SINGLE_AGE_TOP,
  singleAgeKey,
  wholeSelectionRun,
} from "../../utils/ageImpact";

/** The youngest age counted as a pensioner in fiscal year `year`. */
export const pensionerAge = (year) => (Number(year) <= 2026 ? 66 : 67);

/** "66 and over" for the year. */
export const pensionerAgeLabel = (year) => `${pensionerAge(year)} and over`;

/** The single-age chart's ages: 55 to 90 and over. */
export const PENSIONER_AGE_FIRST = 55;
export const PENSIONER_AGE_LAST = SINGLE_AGE_TOP;

/** Below this (in £ a year) a mean change counts as no change. */
const NO_EFFECT = 0.005;

const OUTCOME_KEYS = ["pct_better_off", "pct_unchanged", "pct_worse_off"];

// One lookup per rows array: reform|year|age_band → row
const INDEX = new WeakMap();
function indexOf(rows) {
  let index = INDEX.get(rows);
  if (!index) {
    index = new Map();
    for (const row of rows) index.set(`${row.reform_id}|${row.year}|${row.age_band}`, row);
    INDEX.set(rows, index);
  }
  return index;
}

const lookup = (rows, id, year, band) => indexOf(rows ?? []).get(`${id}|${Number(year)}|${band}`);

/**
 * One run's figures for everyone aged `from` and over in `year`, from its
 * single-age rows weighted by people: { people, sample_size, mean_change,
 * pct_better_off, pct_unchanged, pct_worse_off }, or null when any age is
 * missing or has too few survey records.
 */
export function aggregateFrom(rows, id, year, from) {
  let people = 0;
  let sample = 0;
  const sums = { mean_change: 0, pct_better_off: 0, pct_unchanged: 0, pct_worse_off: 0 };
  for (let age = from; age <= SINGLE_AGE_TOP; age += 1) {
    const row = lookup(rows, id, year, singleAgeKey(age));
    if (!row || row.sample_size < MIN_SAMPLE_SIZE) return null;
    people += row.people;
    sample += row.sample_size;
    for (const key of Object.keys(sums)) sums[key] += row.people * row[key];
  }
  if (people <= 0) return null;
  const out = { people, sample_size: sample };
  for (const key of Object.keys(sums)) out[key] = sums[key] / people;
  return out;
}

/** The pensioners' figures for one run in `year` (aggregateFrom at pensionerAge). */
export const pensionerRow = (rows, id, year) => aggregateFrom(rows, id, year, pensionerAge(year));

/** Whether any row covers the year. */
const hasYear = (rows, year) => (rows ?? []).some((row) => row.year === Number(year));

/**
 * One point per year: each selected policy's mean change per pensioner
 * (keyed by its name), the net change, and each policy's part for the
 * tooltip. A year with no rows is `published: false`; a year whose
 * pensioner rows are thin for any selected policy is `suppressed`.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string, name: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {Array<number>} years - Every year shown, in order
 */
export function pensionerTrend(rows, policies, selected, years) {
  return years.map((year) => {
    const point = { year: Number(year), published: hasYear(rows, year), suppressed: false, netChange: null, parts: [] };
    for (const policy of policies) point[policy.name] = 0;
    if (!point.published) return point;
    let net = 0;
    for (const policy of policies) {
      if (!selected.includes(policy.id)) continue;
      const group = pensionerRow(rows, policy.id, year);
      if (!group) {
        point.suppressed = true;
        continue;
      }
      point[policy.name] = group.mean_change;
      net += group.mean_change;
      point.parts.push({ id: policy.id, name: policy.name, value: group.mean_change });
    }
    point.parts.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    if (point.suppressed) {
      for (const policy of policies) point[policy.name] = 0;
      point.parts = [];
    } else {
      point.netChange = net;
    }
    return point;
  });
}

/**
 * Each selected policy's mean change per pensioner (`group`) beside its
 * all-ages figure (`all`) in `year`, largest pensioner figure first, in
 * the shape of measureComparison (youngPeopleData.js) so the Young people
 * dumbbell draws it. Policies with no effect on either are in `noEffect`;
 * those with a thin pensioner age in `suppressed`.
 */
export function pensionerMeasures(rows, policies, selected, year) {
  const shown = [];
  const noEffect = [];
  const suppressed = [];
  for (const policy of policies) {
    if (!selected.includes(policy.id)) continue;
    const all = lookup(rows, policy.id, year, ALL_BAND);
    if (!all) continue;
    const group = pensionerRow(rows, policy.id, year);
    if (!group) {
      suppressed.push(policy.name);
    } else if (Math.abs(group.mean_change) < NO_EFFECT && Math.abs(all.mean_change) < NO_EFFECT) {
      noEffect.push({ id: policy.id, name: policy.name });
    } else {
      shown.push({ id: policy.id, name: policy.name, group: group.mean_change, all: all.mean_change });
    }
  }
  shown.sort((a, b) => Math.abs(b.group) - Math.abs(a.group) || Math.abs(b.all) - Math.abs(a.all));
  return { shown, noEffect, suppressed };
}

/**
 * Better off, unchanged and worse off for pensioners, for people under
 * State Pension age (all ages less the pensioners, by people) and for all
 * ages, from the whole selection's run: `{ run, groups: [{ key, label,
 * row }] }`, or null when the selection has no such run, the year no rows,
 * or the pensioners' rows are thin.
 */
export function pensionerShares(rows, policies, selected, year) {
  const run = wholeSelectionRun(policies, selected);
  if (!run) return null;
  const all = lookup(rows, run, year, ALL_BAND);
  const pensioners = pensionerRow(rows, run, year);
  if (!all || !pensioners) return null;
  const restPeople = all.people - pensioners.people;
  if (restPeople <= 0) return null;
  const rest = { people: restPeople, sample_size: all.sample_size - pensioners.sample_size };
  for (const key of OUTCOME_KEYS) {
    // Never below zero from rounding in the subtraction
    rest[key] = Math.max(0, (all.people * all[key] - pensioners.people * pensioners[key]) / restPeople);
  }
  return {
    run,
    groups: [
      { key: "pensioners", label: "Pensioners", row: pensioners },
      { key: "under", label: "Under State Pension age", row: rest },
      { key: ALL_BAND, label: "All ages", row: all },
    ],
  };
}

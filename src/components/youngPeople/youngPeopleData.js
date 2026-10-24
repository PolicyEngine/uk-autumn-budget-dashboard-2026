/**
 * Data for the "Effect of each policy" and "Change by year" cards: each
 * measure's average change for a chosen age group beside its all-ages
 * figure, and the average change for every age group in every year shown.
 *
 * Both read only mean_change from public/data/age_impact.csv. A mean
 * change is additive across policies (the other charts on the page add up
 * each policy's own effect), so the year-by-year series adds them up too.
 * Shares and counts are never added up here.
 */
import {
  AGE_GROUPS,
  ALL_BAND,
  MIN_SAMPLE_SIZE,
  YOUNG_BAND,
  singleAgeKey,
} from "../../utils/ageImpact";
import { CHART_COLOURS } from "../../utils/chartTheme";

/**
 * A colour per age group for charts that show them all: 16 to 24 in the
 * page's teal, the other bands blues under 50 and purples from 50, each
 * darker with age, and all ages in grey (dashed where drawn as a line).
 */
export const GROUP_STYLES = {
  "0-15": { color: CHART_COLOURS.ageChildren },
  "16-24": { color: CHART_COLOURS.gain },
  "25-34": { color: CHART_COLOURS.ageYoungAdults },
  "35-49": { color: CHART_COLOURS.ageAdults },
  "50-64": { color: CHART_COLOURS.ageOlder },
  "65+": { color: CHART_COLOURS.agePension },
  all: { color: CHART_COLOURS.reference, dash: "5 3" },
};

/** Below this (in £ a year) a mean change counts as no change. */
const NO_EFFECT = 0.005;

export const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
export const signedPounds = (value) =>
  value < 0 ? `-£${Math.abs(Math.round(value)).toLocaleString("en-GB")}` : pounds(value);

const findRow = (rows, id, year, band) =>
  (rows ?? []).find(
    (row) => row.reform_id === id && row.year === Number(year) && row.age_band === band,
  );

/**
 * One entry per selected policy with rows in the year: its mean change for
 * the chosen age group (`group`) and for all people (`all`), sorted by the
 * size of the group's figure, largest first. Policies with no effect on
 * either are listed in `noEffect`; policies whose group row has too few
 * survey records in `suppressed`.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string, name: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 * @param {string} [band] - The age group's key (default 16 to 24)
 */
export function measureComparison(rows, policies, selected, year, band = YOUNG_BAND) {
  const shown = [];
  const noEffect = [];
  const suppressed = [];
  for (const policy of policies) {
    if (!selected.includes(policy.id) || policy.displayable === false) continue;
    const group = findRow(rows, policy.id, year, band);
    const all = findRow(rows, policy.id, year, ALL_BAND);
    if (!group || !all || !Number.isFinite(group.mean_change) || !Number.isFinite(all.mean_change)) continue;
    if (group.sample_size < MIN_SAMPLE_SIZE || all.sample_size < MIN_SAMPLE_SIZE) {
      suppressed.push(policy.name);
    } else if (Math.abs(group.mean_change) < NO_EFFECT && Math.abs(all.mean_change) < NO_EFFECT) {
      noEffect.push(policy.name);
    } else {
      shown.push({ id: policy.id, name: policy.name, group: group.mean_change, all: all.mean_change });
    }
  }
  shown.sort((a, b) => Math.abs(b.group) - Math.abs(a.group) || Math.abs(b.all) - Math.abs(a.all));
  return { shown, noEffect, suppressed };
}

/**
 * One point per year: for every age group (AGE_GROUPS, keyed by its key),
 * the selected policies' mean changes added up. A year with no rows is
 * `published: false` with null values, never zero; a group whose row in
 * the year is too thin is null and listed in `suppressed`.
 *
 * @param {Array<Object>} rows
 * @param {Array<{id: string, name: string}>} policies
 * @param {Array<string>} selected
 * @param {Array<number>} years - Every year shown, in order
 */
export function changeByYear(rows, policies, selected, years) {
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  const completeSelection = chosen.length > 0 && chosen.length === selected.length;
  return years.map((year) => {
    const point = { year, published: false, suppressed: [] };
    for (const group of AGE_GROUPS) point[group.key] = null;
    if (!completeSelection || chosen.some((policy) => !(rows ?? []).some((row) => row.year === Number(year) && row.reform_id === policy.id))) return point;
    point.published = true;
    for (const group of AGE_GROUPS) {
      let total = 0;
      let thin = false;
      let incomplete = false;
      for (const policy of chosen) {
        const row = findRow(rows, policy.id, year, group.key);
        if (row && row.sample_size < MIN_SAMPLE_SIZE) thin = true;
        if (!row || !Number.isFinite(row.mean_change)) incomplete = true;
        else total += row.mean_change;
      }
      if (thin) point.suppressed.push(group.key);
      if (!thin && !incomplete) point[group.key] = total;
    }
    return point;
  });
}

/**
 * Ticks from a nice step covering [min, max] and zero: steps of 25, 50,
 * 100, 200, 250, 500, 1,000 or 2,500, about four to six of them.
 */
export function niceRange(min, max) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const span = Math.max(high - low, 1);
  const steps = [25, 50, 100, 200, 250, 500, 1000, 2500];
  const step = steps.find((candidate) => span / candidate <= 5) ?? 5000;
  const bottom = Math.floor(low / step) * step;
  const top = Math.ceil(high / step) * step;
  const ticks = [];
  for (let tick = bottom; tick <= top + 1e-9; tick += step) ticks.push(tick);
  if (ticks.length < 2) ticks.push(bottom + step);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/** Split a label into lines of at most `max` characters, at spaces. */
export function wrapWords(text, max) {
  const lines = [];
  for (const word of String(text).split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** The single-year view's ages: one bar per year of age, 10 to 40. */
export const SINGLE_AGE_FIRST = 10;
export const SINGLE_AGE_LAST = 40;

/**
 * One bar per single year of age, SINGLE_AGE_FIRST to SINGLE_AGE_LAST: the
 * selected policies' mean changes added up (`netChange`). A bar is null
 * where any selected policy has no row for the age (the generator leaves
 * out an age with too few survey records) or a thin one.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 */
export function singleAgeBars(rows, policies, selected, year) {
  const byKey = new Map();
  for (const row of rows ?? []) {
    if (row.year === Number(year)) byKey.set(`${row.reform_id}|${row.age_band}`, row);
  }
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  const bars = [];
  for (let age = SINGLE_AGE_FIRST; age <= SINGLE_AGE_LAST; age += 1) {
    let net = 0;
    let complete = chosen.length > 0 && chosen.length === selected.length;
    for (const policy of chosen) {
      const row = byKey.get(`${policy.id}|${singleAgeKey(age)}`);
      if (!row || row.sample_size < MIN_SAMPLE_SIZE || !Number.isFinite(row.mean_change)) {
        complete = false;
        break;
      }
      net += row.mean_change;
    }
    bars.push({ age, label: String(age), netChange: complete ? net : null });
  }
  return bars;
}

/**
 * A y-axis fitted to the data: a nice step (25 to 5,000) giving at most six
 * intervals, from a little below the minimum to a little above the maximum
 * (4% of the span either side), always including zero.
 */
export function fitRange(min, max) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const pad = Math.max(high - low, 1) * 0.04;
  const lo = low < 0 ? low - pad : 0;
  const hi = high > 0 ? high + pad : 0;
  const span = Math.max(hi - lo, 1);
  const steps = [25, 50, 100, 200, 250, 400, 500, 1000, 2000, 2500, 5000];
  const step = steps.find((candidate) => span / candidate <= 6) ?? 10000;
  const bottom = Math.floor(lo / step) * step;
  const top = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let tick = bottom; tick <= top + 1e-9; tick += step) ticks.push(tick);
  if (ticks.length < 2) ticks.push(bottom + step);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

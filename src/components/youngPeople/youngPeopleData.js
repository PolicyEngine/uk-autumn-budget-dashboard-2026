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
  wholeSelectionRun,
} from "../../utils/ageImpact";
import { CHART_COLOURS, REFERENCE_DASH } from "../../utils/chartTheme";

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
  all: { color: CHART_COLOURS.reference, dash: REFERENCE_DASH },
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
export function measureComparison(rows, policies, selected, year, band = YOUNG_BAND, compareBand = ALL_BAND) {
  const shown = [];
  const noEffect = [];
  const suppressed = [];
  for (const policy of policies) {
    if (!selected.includes(policy.id) || policy.displayable === false) continue;
    const group = findRow(rows, policy.id, year, band);
    const all = findRow(rows, policy.id, year, compareBand);
    // No rows at all this year: nothing to say. All ages but no row for the
    // group: its bands withheld (too few survey records), said, never dropped
    if (!group && !all) continue;
    if (!group || !all || !Number.isFinite(group.mean_change) || !Number.isFinite(all.mean_change)) {
      if (all && !group) suppressed.push(policy.name);
      continue;
    }
    if (group.sample_size < MIN_SAMPLE_SIZE || all.sample_size < MIN_SAMPLE_SIZE) {
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
 * One point per year: for every age group (AGE_GROUPS, keyed by its key),
 * the selected policies' mean changes added up. A year with no rows is
 * `published: false` with null values, never zero; a group whose row in
 * the year is too thin is null and listed in `suppressed`; a group with no
 * row for a selected policy in a year it publishes (the generator withholds
 * a policy's age bands when some are too thin to publish, keeping all ages)
 * is null and listed in `missing`, so the card can say so. With several
 * policies and no package, such a year is null in every group and
 * `combinationUnavailable` (never half drawn).
 *
 * @param {Array<Object>} rows
 * @param {Array<{id: string, name: string}>} policies
 * @param {Array<string>} selected
 * @param {Array<number>} years - Every year shown, in order
 * @param {string|null} [packageRun] - The published combined run of exactly
 *   the selection (selectionPackageKey), read instead of summing singles
 */
export function changeByYear(rows, policies, selected, years, packageRun = null) {
  // The selection is a published combined package: its own run's rows,
  // never the singles summed (a single's withheld bands would blank them)
  if (packageRun && (rows ?? []).some((row) => row.reform_id === packageRun)) {
    return years.map((year) => {
      const point = { year, published: false, suppressed: [], missing: [] };
      for (const group of AGE_GROUPS) point[group.key] = null;
      if (!(rows ?? []).some((row) => row.year === Number(year) && row.reform_id === packageRun)) return point;
      point.published = true;
      for (const group of AGE_GROUPS) {
        const row = findRow(rows, packageRun, year, group.key);
        if (row && row.sample_size < MIN_SAMPLE_SIZE) point.suppressed.push(group.key);
        else if (!row || !Number.isFinite(row.mean_change)) point.missing.push(group.key);
        else point[group.key] = row.mean_change;
      }
      return point;
    });
  }
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  const completeSelection = chosen.length > 0 && chosen.length === selected.length;
  return years.map((year) => {
    const point = { year, published: false, suppressed: [], missing: [] };
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
      else if (incomplete) point.missing.push(group.key);
      if (!thin && !incomplete) point[group.key] = total;
    }
    // Several policies with no package: a year drawn whole or not at all
    if (new Set(selected).size > 1 && (point.suppressed.length || point.missing.length)) {
      for (const group of AGE_GROUPS) point[group.key] = null;
      return { ...point, suppressed: [], missing: [], combinationUnavailable: true };
    }
    return point;
  });
}

/**
 * Ticks from a nice step covering [min, max] and zero: steps of 25, 50,
 * 100, 200, 250, 500, 1,000 or 2,500, at most `maxSteps` intervals (five
 * by default, so up to six ticks).
 */
export function niceRange(min, max, { maxSteps = 5 } = {}) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const steps = [25, 50, 100, 200, 250, 500, 1000, 2500];
  // Counted after rounding the ends out, so −100 to 700 is not drawn in
  // five steps of 200 when four are asked for
  const step =
    steps.find((candidate) => Math.ceil(high / candidate - 1e-9) - Math.floor(low / candidate + 1e-9) <= maxSteps) ?? 5000;
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
 * One bar per single year of age, `first` to `last` (SINGLE_AGE_FIRST to
 * SINGLE_AGE_LAST unless given; the Pensioners sub-tab asks for older
 * ages): the selected policies' mean changes added up (`netChange`). A bar
 * is null where any selected policy has no row for the age (the generator
 * leaves out an age with too few survey records) or a thin one.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 * @param {number} [first]
 * @param {number} [last]
 */
export function singleAgeBars(rows, policies, selected, year, first = SINGLE_AGE_FIRST, last = SINGLE_AGE_LAST) {
  const byKey = new Map();
  for (const row of rows ?? []) {
    if (row.year === Number(year)) byKey.set(`${row.reform_id}|${row.age_band}`, row);
  }
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  const bars = [];
  for (let age = first; age <= last; age += 1) {
    let net = 0;
    let complete = chosen.length > 0 && chosen.length === selected.length;
    const parts = [];
    for (const policy of chosen) {
      const row = byKey.get(`${policy.id}|${singleAgeKey(age)}`);
      if (!row || row.sample_size < MIN_SAMPLE_SIZE || !Number.isFinite(row.mean_change)) {
        complete = false;
        break;
      }
      net += row.mean_change;
      parts.push({
        id: policy.id,
        key: policy.seriesKey ?? `measure:${policy.id}`,
        name: policy.label ?? policy.name,
        value: row.mean_change,
      });
    }
    // Each policy's own change, for the tooltip, largest first
    parts.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    // Each policy's own change under its series key too, for the stacked bars
    const bySeries = complete ? Object.fromEntries(parts.map((part) => [part.key, part.value])) : {};
    bars.push({ age, label: singleAgeKey(age), netChange: complete ? net : null, parts: complete ? parts : [], ...bySeries });
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

/**
 * Gain, no change and lose for each single year of age, `ages` (the chosen
 * group's [first, last]; SINGLE_AGE_FIRST to SINGLE_AGE_LAST unless given),
 * from the whole selection's run only, never singles added up (as
 * for the age groups, `combinedId` the catalogue's package run):
 * `{ run, groups: [{ key, label, row, suppressed }] }`, or null when the
 * selection has no such run or the year no rows. An age
 * with fewer than MIN_SAMPLE_SIZE survey records is suppressed.
 */
export function sharesBySingleAge(rows, policies, selected, year, combinedId = null, ages = [SINGLE_AGE_FIRST, SINGLE_AGE_LAST]) {
  const run = wholeSelectionRun(policies, selected, combinedId);
  if (!run) return null;
  const yearRows = (rows ?? []).filter((row) => row.year === Number(year) && row.reform_id === run);
  if (!yearRows.length) return null;
  const groups = [];
  const byAge = new Map(yearRows.map((candidate) => [candidate.age_band, candidate]));
  for (let age = ages[0]; age <= ages[1]; age += 1) {
    const row = byAge.get(singleAgeKey(age)) ?? null;
    const usable = row && row.sample_size >= MIN_SAMPLE_SIZE ? row : null;
    groups.push({ key: String(age), label: singleAgeKey(age), age, row: usable, suppressed: !usable });
  }
  return { run, groups };
}

/**
 * One age group's change in every year shown, with each selected measure's
 * own part: `{ year, published, net, parts: [{ id, key, value }], ...bySeries }`
 * (each part also under its series key, for stacked bars). `net` is null in
 * a year not published, or where any measure's row is missing or too thin.
 */
export function groupMeasureSeries(rows, policies, selected, years, band = YOUNG_BAND) {
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  return years.map((year) => {
    const parts = [];
    let complete = chosen.length > 0 && chosen.length === selected.length;
    for (const policy of chosen) {
      const row = findRow(rows, policy.id, year, band);
      if (!row || row.sample_size < MIN_SAMPLE_SIZE || !Number.isFinite(row.mean_change)) {
        complete = false;
        break;
      }
      parts.push({ id: policy.id, key: policy.seriesKey ?? `measure:${policy.id}`, value: row.mean_change });
    }
    const bySeries = complete ? Object.fromEntries(parts.map((part) => [part.key, part.value])) : {};
    return {
      year,
      published: complete,
      net: complete ? parts.reduce((sum, part) => sum + part.value, 0) : null,
      parts: complete ? parts : [],
      ...bySeries,
    };
  });
}

/**
 * Running totals over the years: each key's value is replaced by its sum
 * from the first year to that one (a year with no value stops the sum, so a
 * gap is never read as zero).
 */
export function cumulate(points, keys) {
  const running = Object.fromEntries(keys.map((key) => [key, 0]));
  const broken = new Set();
  return points.map((point) => {
    const next = { ...point };
    for (const key of keys) {
      const value = point[key];
      if (value === null || value === undefined || !Number.isFinite(value) || broken.has(key)) {
        broken.add(key);
        next[key] = null;
      } else {
        running[key] += value;
        next[key] = running[key];
      }
    }
    return next;
  });
}

/**
 * The year-on-year steps worth pointing out in a group's series, and the
 * measure behind each: the largest steps (at most `limit`) that are at
 * least `share` of the series' range, each with the measure whose own
 * change between the two years moved most in the step's direction.
 * Computed from the per-measure rows, so a new or changed measure is named
 * by the data, never by a list here.
 *
 * @returns {Array<{year: number, from: number, step: number, value: number, measureId: string, ends: boolean}>}
 */
export function stepAnnotations(series, { limit = 2, share = 0.3 } = {}) {
  const values = series.map((point) => point.net).filter((value) => value !== null);
  if (values.length < 2) return [];
  const range = Math.max(...values, 0) - Math.min(...values, 0);
  if (range <= 0) return [];
  const steps = [];
  for (let i = 1; i < series.length; i += 1) {
    const before = series[i - 1];
    const after = series[i];
    if (before.net === null || after.net === null) continue;
    const step = after.net - before.net;
    if (Math.abs(step) < share * range) continue;
    const partOf = (point, id) => point.parts.find((part) => part.id === id)?.value ?? 0;
    const ids = new Set([...before.parts, ...after.parts].map((part) => part.id));
    let measureId = null;
    let best = 0;
    for (const id of ids) {
      const moved = (partOf(after, id) - partOf(before, id)) * Math.sign(step);
      if (moved > best) {
        best = moved;
        measureId = id;
      }
    }
    if (measureId) {
      // The step comes from the measure ending (it is in force the year
      // before and not after), so the headline and label never say it applies
      const ends = Math.abs(partOf(before, measureId)) >= 0.5 && Math.abs(partOf(after, measureId)) < 0.5;
      steps.push({ year: after.year, from: before.year, step, value: after.net, measureId, ends });
    }
  }
  return steps.sort((a, b) => Math.abs(b.step) - Math.abs(a.step)).slice(0, limit).sort((a, b) => a.year - b.year);
}

/** The measures that make up most of a point's change, largest first. */
export function topParts(point, count = 2) {
  return [...(point?.parts ?? [])]
    .filter((part) => Math.abs(part.value) >= 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, count);
}

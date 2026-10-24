/**
 * Data for the two further "Young people" cards: each measure's average
 * change for young people aged 16 to 24 beside its all-ages figure, and
 * the average change in every year shown.
 *
 * Both read only mean_change from public/data/age_impact.csv. A mean
 * change is additive across policies (the other charts on the page add up
 * each policy's own effect), so the year-by-year series adds them up too.
 * Shares and counts are never added up here.
 */
import { ALL_BAND, MIN_SAMPLE_SIZE, YOUNG_BAND } from "../../utils/ageImpact";

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
 * people aged 16 to 24 (`young`) and for all people (`all`), sorted by the
 * size of the 16 to 24 figure, largest first. Policies with no effect on
 * either group are listed in `noEffect`; policies whose 16 to 24 row has
 * too few survey records in `suppressed`.
 *
 * @param {Array<Object>} rows - Typed age_impact rows
 * @param {Array<{id: string, name: string}>} policies - Every policy
 * @param {Array<string>} selected - Selected policy ids
 * @param {number} year
 */
export function measureComparison(rows, policies, selected, year) {
  const shown = [];
  const noEffect = [];
  const suppressed = [];
  for (const policy of policies) {
    if (!selected.includes(policy.id)) continue;
    const young = findRow(rows, policy.id, year, YOUNG_BAND);
    const all = findRow(rows, policy.id, year, ALL_BAND);
    if (!young || !all) continue;
    if (young.sample_size < MIN_SAMPLE_SIZE) {
      suppressed.push(policy.name);
    } else if (Math.abs(young.mean_change) < NO_EFFECT && Math.abs(all.mean_change) < NO_EFFECT) {
      noEffect.push(policy.name);
    } else {
      shown.push({ id: policy.id, name: policy.name, young: young.mean_change, all: all.mean_change });
    }
  }
  shown.sort((a, b) => Math.abs(b.young) - Math.abs(a.young) || Math.abs(b.all) - Math.abs(a.all));
  return { shown, noEffect, suppressed };
}

/**
 * One point per year: the selected policies' mean changes added up, for
 * people aged 16 to 24 (`young`) and for all people (`all`). A year with
 * no rows is `published: false` with null values, never zero; so is a year
 * whose 16 to 24 rows are too thin (`suppressed: true`).
 *
 * @param {Array<Object>} rows
 * @param {Array<{id: string, name: string}>} policies
 * @param {Array<string>} selected
 * @param {Array<number>} years - Every year shown, in order
 */
export function changeByYear(rows, policies, selected, years) {
  return years.map((year) => {
    const point = { year, published: false, suppressed: false, young: null, all: null };
    if (!(rows ?? []).some((row) => row.year === Number(year))) return point;
    point.published = true;
    let young = 0;
    let all = 0;
    for (const policy of policies) {
      if (!selected.includes(policy.id)) continue;
      const youngRow = findRow(rows, policy.id, year, YOUNG_BAND);
      const allRow = findRow(rows, policy.id, year, ALL_BAND);
      if (youngRow && youngRow.sample_size < MIN_SAMPLE_SIZE) point.suppressed = true;
      young += youngRow ? youngRow.mean_change : 0;
      all += allRow ? allRow.mean_change : 0;
    }
    if (!point.suppressed) {
      point.young = young;
      point.all = all;
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

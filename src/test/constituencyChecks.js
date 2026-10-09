/**
 * Local-area consistency check for constituency results, run in CI for every
 * verified reform ID. It mirrors the constituency/demographic check in
 * scripts/validate_published_data.py (PR #3): each constituency's
 * average_gain must equal the household-weighted mean of its demographic
 * groups' average_gain within £0.05. It is stricter in one way: a
 * constituency with no demographic rows fails instead of being skipped.
 */

import { parseCsvLine } from "../utils/constituencyData";
import SKETCHES_2025 from "./constituency2025Sketches.json";

export { SKETCHES_2025 };

/** Parse demographic_constituency.csv into typed rows. */
export function parseDemographicCsv(csvText) {
  const lines = csvText.replace(/\r/g, "").split("\n");
  const headers = parseCsvLine(lines[0] ?? "");
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const values = parseCsvLine(line);
      return {
        reform_id: values[index.reform_id],
        year: Number(values[index.year]),
        constituency_code: values[index.constituency_code],
        average_gain: Number(values[index.average_gain]),
        household_count: Number(values[index.household_count]),
      };
    });
}

/**
 * Return one message per constituency whose published average_gain
 * disagrees with its demographic groups, for the given reform IDs and years.
 */
export function crossCheckConstituencyRows(
  constituencyRows,
  demographicRows,
  { policyIds, years, tolerance = 0.05 },
) {
  const wanted = (row) =>
    policyIds.includes(row.reform_id) && years.includes(row.year);
  const key = (row) => `${row.reform_id}|${row.year}|${row.constituency_code}`;

  const groups = new Map();
  for (const row of demographicRows) {
    if (!wanted(row)) continue;
    const [weighted, households] = groups.get(key(row)) ?? [0, 0];
    groups.set(key(row), [
      weighted + row.household_count * row.average_gain,
      households + row.household_count,
    ]);
  }

  const problems = [];
  for (const row of constituencyRows) {
    if (!wanted(row)) continue;
    const [weighted, households] = groups.get(key(row)) ?? [0, 0];
    if (!(households > 0)) {
      problems.push(`${key(row)}: no demographic rows`);
      continue;
    }
    const average = weighted / households;
    if (!(Math.abs(average - row.average_gain) <= tolerance)) {
      problems.push(
        `${key(row)}: ${row.average_gain} published, ${average} from groups`,
      );
    }
  }
  return problems;
}

// SHA-256 of the constituency files the 2025 dashboard shipped, which main
// still carries. They are not Microcosm output, so no certification may pin
// them.
export const UNCERTIFIED_2025_SHA256 = new Set([
  "f58941e59ff701573bc97dfa3cf33da441b2da0558b1e11030a6ca8911b5d965",
  "ba974b52ad13a4e97f28c74d334257d1d2ea6dc425f062703f57b5020d507cad",
]);

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Check the certification manifest that must accompany any verified reform
 * ID (public/data/constituency_certification.json). It names the Microcosm
 * release the constituency rows came from and pins the bytes of both local
 * files, so regenerated or carried-over rows cannot inherit a certification.
 * Returns one message per problem.
 *
 * @param {object} manifest - parsed manifest
 * @param {object} files
 * @param {string} files.constituencySha256 - SHA-256 of constituency.csv
 * @param {string} files.demographicSha256 - SHA-256 of demographic_constituency.csv
 * @param {string[]} verifiedIds - VERIFIED_CONSTITUENCY_POLICY_IDS
 */
export function checkCertificationManifest(
  manifest,
  { constituencySha256, demographicSha256 },
  verifiedIds,
) {
  const problems = [];
  if (!/^microcosm-/.test(manifest?.dataset_release ?? "")) {
    problems.push("dataset_release must name a Microcosm release");
  }
  if (!SHA256.test(manifest?.constituency_weights_sha256 ?? "")) {
    problems.push("constituency_weights_sha256 must be a SHA-256");
  }
  if (manifest?.constituency_csv_sha256 !== constituencySha256) {
    problems.push("constituency.csv does not match the certified SHA-256");
  }
  if (manifest?.demographic_constituency_csv_sha256 !== demographicSha256) {
    problems.push(
      "demographic_constituency.csv does not match the certified SHA-256",
    );
  }
  for (const sha of [constituencySha256, demographicSha256]) {
    if (UNCERTIFIED_2025_SHA256.has(sha)) {
      problems.push(`${sha} is the 2025 dashboard's uncertified file`);
    }
  }
  const certified = new Set(manifest?.reform_ids ?? []);
  for (const id of verifiedIds) {
    if (!certified.has(id)) problems.push(`${id} is not in reform_ids`);
  }
  return problems;
}

/**
 * Fingerprint of one reform ID's constituency values, per year: the number
 * of rows, the mean and root-mean-square of the £ change, and the mean of
 * the % change. It ignores names, row order and number formatting.
 */
export function policyValueSketch(rows, reformId) {
  const byYear = {};
  for (const row of rows) {
    if (row.reform_id !== reformId) continue;
    const s = (byYear[row.year] ??= { n: 0, gain: 0, gainSq: 0, rel: 0 });
    s.n += 1;
    s.gain += row.average_gain;
    s.gainSq += row.average_gain ** 2;
    s.rel += row.relative_change;
  }
  return Object.fromEntries(
    Object.entries(byYear).map(([year, s]) => [
      year,
      {
        n: s.n,
        mean_gain: s.gain / s.n,
        rms_gain: Math.sqrt(s.gainSq / s.n),
        mean_relative: s.rel / s.n,
      },
    ]),
  );
}

// Rounding each value to the penny (or to 4 dp of a percentage point) moves
// these means by less than this; regenerating a measure on new data moves
// them by far more.
const SKETCH_TOLERANCE = { gbp: 0.01, pct: 1e-4 };

/**
 * True when any year in which the measure had an effect in 2025 still has its
 * 2025 values, to rounding: the rows were carried over (possibly re-saved at
 * lower precision, or alongside new years). Years with no 2025 effect are
 * skipped, since a regenerated measure may legitimately be zero there too.
 */
export function carriesOver2025Year(sketch, reference) {
  return Object.entries(reference).some(([year, b]) => {
    const a = sketch[year];
    return (
      b.rms_gain > 0 &&
      a !== undefined &&
      a.n === b.n &&
      Math.abs(a.mean_gain - b.mean_gain) <= SKETCH_TOLERANCE.gbp &&
      Math.abs(a.rms_gain - b.rms_gain) <= SKETCH_TOLERANCE.gbp &&
      Math.abs(a.mean_relative - b.mean_relative) <= SKETCH_TOLERANCE.pct
    );
  });
}

/**
 * Reform IDs with any year still carrying the 2025 dashboard's values, even
 * inside a changed file, at lower precision or next to new years
 * (constituency2025Sketches.json holds policyValueSketch of each ID in the
 * 2025 file).
 */
export function carriedOver2025Policies(rows, reformIds) {
  return reformIds.filter(
    (id) =>
      Object.hasOwn(SKETCHES_2025, id) &&
      carriesOver2025Year(policyValueSketch(rows, id), SKETCHES_2025[id]),
  );
}

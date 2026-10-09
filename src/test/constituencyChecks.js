/**
 * Local-area consistency check for constituency results, run in CI for every
 * verified reform ID. It mirrors the constituency/demographic check in
 * scripts/validate_published_data.py (PR #3): each constituency's
 * average_gain must equal the household-weighted mean of its demographic
 * groups' average_gain within £0.05. It is stricter in one way: a
 * constituency with no demographic rows fails instead of being skipped.
 */

import { parseCsvLine } from "../utils/constituencyData";
import SAMPLES_2025 from "./constituency2025Samples.json";

export { SAMPLES_2025 };

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
 * One reform ID's values for a fixed sample of constituencies, per year:
 * `{year: {code: [average_gain, relative_change]}}`. Comparing individual
 * seats tells carried-over rows from regenerated ones far better than
 * national means can, and ignores names, row order and number formatting.
 */
export function policyValueSample(rows, reformId, codes) {
  const wanted = new Set(codes);
  const byYear = {};
  for (const row of rows) {
    if (row.reform_id !== reformId || !wanted.has(row.constituency_code)) {
      continue;
    }
    (byYear[row.year] ??= {})[row.constituency_code] = [
      row.average_gain,
      row.relative_change,
    ];
  }
  return byYear;
}

// Rounding to the penny (or to 4 dp of a percentage point) moves a value by
// less than this. A regeneration on new data moves most seats by far more.
export const SAMPLE_TOLERANCE = { gbp: 0.01, pct: 1e-4 };

/**
 * True when, in any year in which the measure had an effect in 2025, every
 * sampled seat still has its 2025 values to rounding: the rows were carried
 * over (possibly re-saved at lower precision, or alongside new years). Years
 * with no 2025 effect are skipped, since a regenerated measure may
 * legitimately be zero there too.
 */
export function carriesOver2025Year(sample, reference) {
  return Object.entries(reference).some(([year, seats]) => {
    const current = sample[year];
    const values = Object.entries(seats);
    return (
      current !== undefined &&
      values.some(([, [gain]]) => gain !== 0) &&
      values.every(([code, [gain, relative]]) => {
        const now = current[code];
        return (
          now !== undefined &&
          Math.abs(now[0] - gain) <= SAMPLE_TOLERANCE.gbp &&
          Math.abs(now[1] - relative) <= SAMPLE_TOLERANCE.pct
        );
      })
    );
  });
}

/**
 * Reform IDs with any year still carrying the 2025 dashboard's values, even
 * inside a changed file, at lower precision or next to new years
 * (constituency2025Samples.json holds policyValueSample of each ID in the
 * 2025 file, for 20 constituencies spaced through the sorted codes).
 */
export function carriedOver2025Policies(rows, reformIds) {
  return reformIds.filter(
    (id) =>
      Object.hasOwn(SAMPLES_2025.policies, id) &&
      carriesOver2025Year(
        policyValueSample(rows, id, SAMPLES_2025.codes),
        SAMPLES_2025.policies[id],
      ),
  );
}

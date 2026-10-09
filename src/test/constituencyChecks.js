/**
 * Local-area consistency check for constituency results, run in CI for every
 * verified reform ID. It mirrors the constituency/demographic check in
 * scripts/validate_published_data.py (PR #3): each constituency's
 * average_gain must equal the household-weighted mean of its demographic
 * groups' average_gain within £0.05. It is stricter in one way: a
 * constituency with no demographic rows fails instead of being skipped.
 */

import { createHash } from "node:crypto";
import { parseCsvLine } from "../utils/constituencyData";

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
 * Digest of one reform ID's constituency values: year, code, £ and % change.
 * Built from parsed numbers, so it ignores names, row order and number
 * formatting, and catches rows carried over unchanged inside a new file.
 */
export function policyRowsDigest(rows, reformId) {
  const canonical = rows
    .filter((row) => row.reform_id === reformId)
    .map(
      (row) =>
        `${row.year}|${row.constituency_code}|${row.average_gain}|${row.relative_change}`,
    )
    .sort();
  return createHash("sha256").update(canonical.join("\n")).digest("hex");
}

// policyRowsDigest of each reform ID's rows in the 2025 dashboard's
// constituency.csv (the file main carries). A verified ID whose rows still
// digest to its 2025 value has not been regenerated, whatever else changed.
export const UNCERTIFIED_2025_ROW_DIGESTS = {
  autumn_budget_2025_combined:
    "7af609b57cc0bf83cbf248af5e1a27acf605449da6d830fbf1e2ba52dbb1ab88",
  dividend_tax_increase_2pp:
    "49d2cea02cd56b097a995e4342c351486503d8c49e3b56f1dc3cb3c82d66bcc6",
  freeze_student_loan_thresholds:
    "a3a9d5dd91e63fc683bd4a8917d30e7756aa346aba04dd8da90c793a8a4e674f",
  fuel_duty_freeze:
    "73c856a1165465962421c098c08788595432f0d073718fa4ff0f4d021a37a6b9",
  property_tax_increase_2pp:
    "c3abd52ad7f5f0f18443e26c39c6e2a6cb6195f93586edce38d958fa8c8ae2c4",
  rail_fares_freeze:
    "e5b5df954624f8ce4af0f0df8f698809d644049605eac4c7b7d63d3809e2ec28",
  salary_sacrifice_cap:
    "fe2c688e6d57e7fd47e24816fdb471c75a4a9bc55e71c4e00d029014a5a5e667",
  savings_tax_increase_2pp:
    "e8de02816b1b5ad53838b568f7336800d81be205c3f0938391fd6812e723a2e2",
  threshold_freeze_extension:
    "adc872243e869b5358a520cef9c46502cb9ca71f1b242e47493d35b5b1790f15",
  two_child_limit:
    "145434a7b9038343193a3462094f7860218b252c8b55e0cd84574b753278608b",
};

/** Reform IDs whose current rows are still the 2025 dashboard's rows. */
export function carriedOver2025Policies(rows, reformIds) {
  return reformIds.filter(
    (id) =>
      id in UNCERTIFIED_2025_ROW_DIGESTS &&
      policyRowsDigest(rows, id) === UNCERTIFIED_2025_ROW_DIGESTS[id],
  );
}

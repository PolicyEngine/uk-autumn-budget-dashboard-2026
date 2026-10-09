/**
 * Local-area consistency check for constituency results, run in CI for every
 * verified reform ID. It mirrors the constituency/demographic check in
 * scripts/validate_published_data.py (PR #3): each constituency's
 * average_gain must equal the household-weighted mean of its demographic
 * groups' average_gain within £0.05. It is stricter in one way: a
 * constituency with no demographic rows fails instead of being skipped.
 */

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

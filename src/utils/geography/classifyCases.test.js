/**
 * The map's categories, on cases the before/after map check shares.
 *
 * scripts/map_check.py compares a regenerated table of results by area with
 * the published one and counts the constituencies that change colour. It
 * ports classifyRow to Python, and tests/test_map_check.py holds that port
 * to the answers in src/test/fixtures/geography/classify_cases.json. This
 * test holds classifyRow to the same answers, so the script's colours
 * cannot drift from the map's.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATEGORIES, TOO_UNCERTAIN, classifyRow } from "./classify";

const { cases } = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "test",
      "fixtures",
      "geography",
      "classify_cases.json",
    ),
    "utf-8",
  ),
);

describe("classifyRow, on the cases the map check shares", () => {
  it("covers both outcomes and every answer the map can give", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((row) => row.outcome))).toEqual(
      new Set(["average_change", "relative_change"]),
    );
    expect(new Set(cases.map((row) => row.expected))).toEqual(
      new Set([...CATEGORIES, TOO_UNCERTAIN, null]),
    );
  });

  it.each(cases)(
    "$outcome $value ($lo to $hi, $tier) is $expected",
    ({ expected, ...row }) => {
      expect(classifyRow(row)).toBe(expected);
    },
  );
});

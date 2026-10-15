/**
 * The page reads the tables the Python side writes.
 *
 * src/test/fixtures/geography/layer/ is written by the same code that
 * writes public/data/regional.csv and constituency.csv, from synthetic
 * records (tests/geography_fixture.py; a Python test keeps it current). If
 * the two sides drift apart, this test fails.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GeographyTableError, parseGeographyTable } from "./parse";

const LAYER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "geography",
  "layer",
);
const read = (name) => readFileSync(join(LAYER, name), "utf-8");

describe("tables written by the Python side", () => {
  it.each([
    ["regional.csv", "region"],
    ["constituency.csv", "constituency"],
  ])("%s parses, with every tier", (name, level) => {
    const table = parseGeographyTable(read(name), { level });
    expect(table.rows.length).toBeGreaterThan(0);
    expect(new Set(table.rows.map((row) => row.tier))).toEqual(
      new Set(["reported", "approximate", "withheld"]),
    );
    expect(table.reforms.some((reform) => reform.endsWith("_combined"))).toBe(
      true,
    );
  });

  it("refuses a non-zero value that rests on fewer than 10 households", () => {
    const [header, ...rows] = read("regional.csv").trimEnd().split("\n");
    const columns = header.split(",");
    const band = columns.indexOf("support_band");
    const value = columns.indexOf("value");
    const shown = rows
      .map((row) => row.split(","))
      .find((cells) => cells[band] !== "" && Number(cells[value]) !== 0);
    shown[band] = "<10";
    const text = [header, shown.join(",")].join("\n") + "\n";
    expect(() => parseGeographyTable(text, { level: "region" })).toThrow(
      GeographyTableError,
    );
  });
});

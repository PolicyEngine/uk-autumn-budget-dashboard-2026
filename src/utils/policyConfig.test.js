import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICIES } from "./policies";
import { POLICY_RAMPS } from "./chartTheme";
import { DISPLAY_YEARS } from "./displayYears";
import { ALL_POLICY_NAMES, POLICY_COLORS, REVENUE_RAISING_NAMES } from "./policyConfig";

// The full package's £bn by measure and year, from the published file
const rows = readFileSync(resolve(__dirname, "../../public/data/budgetary_impact.csv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(","));

const meanAbs = (name) => {
  const id = POLICIES.find((policy) => policy.name === name).id;
  const values = rows
    .filter((row) => row[0] === id && DISPLAY_YEARS.includes(Number(row[row.length - 2])))
    .map((row) => Math.abs(Number(row[row.length - 1])));
  return values.reduce((sum, value) => sum + value, 0) / DISPLAY_YEARS.length;
};

const group = (raises) => ALL_POLICY_NAMES.filter((name) => REVENUE_RAISING_NAMES.has(name) === raises);

describe("ALL_POLICY_NAMES", () => {
  it("lists each group by size, largest first, as budgetary_impact.csv has it", () => {
    for (const raises of [true, false]) {
      const names = group(raises);
      const sizes = names.map(meanAbs);
      expect(sizes, names.join(" > ")).toEqual([...sizes].sort((a, b) => b - a));
    }
  });
});

describe("POLICY_COLORS", () => {
  it("gives each group its ramp in order, darkest for the largest", () => {
    expect(group(true).map((name) => POLICY_COLORS[name])).toEqual(
      POLICY_RAMPS.raise.slice(0, group(true).length),
    );
    expect(group(false).map((name) => POLICY_COLORS[name])).toEqual(
      POLICY_RAMPS.cost.slice(0, group(false).length),
    );
  });

  it("gives every measure a different colour", () => {
    const colours = ALL_POLICY_NAMES.map((name) => POLICY_COLORS[name]);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

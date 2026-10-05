import { readFileSync, readdirSync } from "node:fs";
import { csvParse } from "d3";
import { it, expect } from "vitest";
import { POLICIES, PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";

it("starts with no selectable or household drill measures", () => {
  expect(POLICIES).toEqual([]);
  expect(PERSONAL_IMPACT_POLICY_ORDER).toEqual([]);
});

it("ships no generated result rows, including auxiliary chart files", () => {
  for (const file of readdirSync("public/data").filter(file => file.endsWith(".csv"))) {
    const rows = csvParse(readFileSync(`public/data/${file}`, "utf8"));
    expect(rows, file).toHaveLength(0);
    expect(rows.columns.length, file).toBeGreaterThan(0);
  }
});

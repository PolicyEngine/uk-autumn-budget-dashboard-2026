import { readFileSync, readdirSync } from "node:fs";
import { csvParse } from "d3";
import { it, expect } from "vitest";
import { POLICIES, PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";

it("lists the statement's mock2 parameter measures in the selector and calculator", () => {
  const mock2 = [
    "mock2_fuel_duty_hold",
    "mock2_electricity_vat_zero",
    "mock2_employer_ni_threshold",
    "mock2_cgt_rates",
    "mock2_hvcts_band",
    "mock2_state_pension_uprating",
  ];
  const ids = POLICIES.map((policy) => policy.id);
  expect(ids.filter((id) => id.startsWith("mock2_"))).toEqual(mock2);
  expect(PERSONAL_IMPACT_POLICY_ORDER).toEqual(ids);
  for (const policy of POLICIES) expect(policy.explanation).toMatch(/^MOCK basis/);
});

it("ships no generated result rows, including auxiliary chart files", () => {
  for (const file of readdirSync("public/data").filter(file => file.endsWith(".csv"))) {
    const rows = csvParse(readFileSync(`public/data/${file}`, "utf8"));
    expect(rows, file).toHaveLength(0);
    expect(rows.columns.length, file).toBeGreaterThan(0);
  }
});

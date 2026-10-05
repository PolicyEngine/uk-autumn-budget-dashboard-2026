import { readFileSync, readdirSync } from "node:fs";
import { csvParse } from "d3";
import { it, expect } from "vitest";
import { POLICIES, PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";

it("registers each drill measure once, with a MOCK basis note", () => {
  const ids = POLICIES.map((policy) => policy.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(expect.arrayContaining([
    "mock2_fuel_duty_hold",
    "mock2_electricity_vat_zero",
    "mock2_employer_ni_threshold",
    "mock2_cgt_rates",
    "mock2_hvcts_band",
    "mock2_state_pension_uprating",
    "mock2_state_pension_personal_allowance",
    "mock2_energy_price_payment",
  ]));
  for (const policy of POLICIES.filter((p) => p.id.startsWith("mock2_"))) {
    expect(policy.explanation, policy.id).toMatch(/^MOCK basis:/);
  }
  expect(PERSONAL_IMPACT_POLICY_ORDER).toEqual(ids);
});

it("ships generated rows only for registered drill measures", () => {
  const ids = new Set(POLICIES.map((policy) => policy.id));
  for (const file of readdirSync("public/data").filter(file => file.endsWith(".csv"))) {
    const rows = csvParse(readFileSync(`public/data/${file}`, "utf8"));
    expect(rows.columns.length, file).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.reform_id !== undefined) expect(ids.has(row.reform_id), `${file}: ${row.reform_id}`).toBe(true);
    }
  }
});

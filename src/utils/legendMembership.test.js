import { describe, expect, it } from "vitest";
import { noPovertyEffectReason } from "./legendMembership";
import { POLICY_DETAILS } from "./policyDetails";

// A measure as the catalogue gives it, described as its entry was written for
const measureFor = (id) => {
  const entry = POLICY_DETAILS.find((item) => item.id === id);
  return { id, name: id, description: entry.writtenFor };
};

describe("why a policy moves no one across the poverty line", () => {
  it("says the Energy payment is not counted in poverty income in its year, and when it is in force otherwise", () => {
    const payment = measureFor("household_energy_payment_2026");
    expect(noPovertyEffectReason(payment, 2026)).toBe("not counted in poverty income");
    expect(noPovertyEffectReason(payment, 2027)).toMatch(/^in force January 2027 to March 2027/);
  });

  it("keeps a price policy's reason", () => {
    expect(noPovertyEffectReason(measureFor("domestic_electricity_zero_vat"), 2027)).toBe("changes prices, not incomes");
  });
});

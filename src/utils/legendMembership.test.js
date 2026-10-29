import { describe, expect, it } from "vitest";
import { noPovertyEffectReason } from "./legendMembership";
import { POLICY_DETAILS } from "./policyDetails";

// A measure as the catalogue gives it, described as its entry was written for
const measureFor = (id) => {
  const entry = POLICY_DETAILS.find((item) => item.id === id);
  return { id, name: id, description: entry.writtenFor };
};

describe("why a policy moves no one across the poverty line", () => {
  it("says poverty income leaves the Energy payment out in its year, and when it is in force otherwise", () => {
    const payment = measureFor("household_energy_payment_2026");
    expect(noPovertyEffectReason(payment, 2026)).toBe("poverty income leaves it out");
    expect(noPovertyEffectReason(payment, 2027)).toMatch(/^in force January 2027 to March 2027/);
  });

  it("keeps a price policy's reason", () => {
    expect(noPovertyEffectReason(measureFor("domestic_electricity_zero_vat"), 2027)).toBe("changes prices, not incomes");
  });

  it("reads a price policy from its published category when its card details do not apply", () => {
    const moved = { id: "domestic_electricity_zero_vat", name: "Zero VAT on domestic electricity", description: "A newer description than the card was written for." };
    expect(noPovertyEffectReason(moved, 2026)).toBe("changes prices, not incomes");
    expect(noPovertyEffectReason({ id: "x", name: "New benefit", description: "A new benefit." }, 2026)).toBe("no one crosses the poverty line");
  });
});

import { describe, expect, it } from "vitest";
import { vatRowLabel } from "./singleYear";

describe("vatRowLabel: the VAT row named by what moves it (Pavel's review, HH5)", () => {
  const types = { fuel: "Fuel duty", elec: "VAT", ni: "National Insurance" };
  const typeOf = (id) => types[id];
  it("is VAT change on fuel duty when only the fuel duty policy, of the pump and VAT ones, moves the household", () => {
    expect(vatRowLabel([{ id: "fuel", rounded: 53 }, { id: "ni", rounded: 343 }], typeOf)).toBe("VAT change on fuel duty");
  });
  it("is VAT change when a VAT policy moves it too, or nothing does", () => {
    expect(vatRowLabel([{ id: "fuel", rounded: 47 }, { id: "elec", rounded: 48 }], typeOf)).toBe("VAT change");
    expect(vatRowLabel([], typeOf)).toBe("VAT change");
    expect(vatRowLabel([{ id: "fuel", rounded: 0 }, { id: "elec", rounded: 48 }], typeOf)).toBe("VAT change");
  });
});

describe("outOfForceReason: why a policy has no effect in the calculator's year (CF2)", () => {
  it("says the Warm Home Discount top-up is winter 2026-27 only", async () => {
    const { outOfForceReason } = await import("./singleYear");
    const { POLICY_DETAILS } = await import("./policyDetails");
    const whd = (POLICY_DETAILS ?? []).find?.((p) => p.id === "warm_home_discount_top_up");
    expect(whd).toBeDefined();
    expect(outOfForceReason({ id: whd.id, description: whd.writtenFor }, 2027)).toBe("Winter 2026-27 only; the calculator starts in 2027-28");
    expect(outOfForceReason({ id: whd.id, description: whd.writtenFor }, 2026)).toBeNull();
  });
});

describe("programmeGroups: the page's own note on the VAT change row", () => {
  it("says the policies, as the rest of the page does, in place of the API's note", async () => {
    const { programmeGroups } = await import("./singleYear");
    const groups = programmeGroups([{ id: "vat_change", group: "tax", before: 0, after: -12, note: "The API's note.", children: [] }]);
    const row = groups.flatMap((group) => group.rows).find((r) => r.id === "vat_change");
    expect(row.note).toBe(
      "Only the change the policies make to VAT on the electricity, petrol and diesel spending entered, not the VAT you pay, so a cut shows as a positive amount.",
    );
    expect(row.note).not.toMatch(/\bmeasures?\b/);
  });
});

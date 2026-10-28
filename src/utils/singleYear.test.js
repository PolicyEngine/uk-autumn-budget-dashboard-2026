import { describe, expect, it } from "vitest";
import { vatRowLabel } from "./singleYear";

describe("vatRowLabel: the VAT row named by what moves it (Pavel's review, HH5)", () => {
  const types = { fuel: "Fuel duty", elec: "VAT", ni: "National Insurance" };
  const typeOf = (id) => types[id];
  it("is VAT on fuel duty when only the fuel duty policy, of the pump and VAT ones, moves the household", () => {
    expect(vatRowLabel([{ id: "fuel", rounded: 53 }, { id: "ni", rounded: 343 }], typeOf)).toBe("VAT on fuel duty");
  });
  it("is VAT when a VAT policy moves it too, or nothing does", () => {
    expect(vatRowLabel([{ id: "fuel", rounded: 47 }, { id: "elec", rounded: 48 }], typeOf)).toBe("VAT");
    expect(vatRowLabel([], typeOf)).toBe("VAT");
    expect(vatRowLabel([{ id: "fuel", rounded: 0 }, { id: "elec", rounded: 48 }], typeOf)).toBe("VAT");
  });
});

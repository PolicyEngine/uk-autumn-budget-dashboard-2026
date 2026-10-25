import { describe, expect, it } from "vitest";
import { changeAxisMax } from "./exampleHouseholds";

describe("the example households' change axis", () => {
  it("fits small changes, so a £7 VAT cut is not flattened onto zero", () => {
    expect(changeAxisMax(6.67)).toBe(10);
    expect(changeAxisMax(13.3)).toBe(20);
    expect(changeAxisMax(49.5)).toBe(50);
    expect(changeAxisMax(155)).toBe(200);
  });

  it("keeps round steps for large changes, and an axis with none", () => {
    expect(changeAxisMax(1000)).toBe(1000);
    expect(changeAxisMax(1200)).toBe(2000);
    expect(changeAxisMax(0)).toBe(10);
  });
});

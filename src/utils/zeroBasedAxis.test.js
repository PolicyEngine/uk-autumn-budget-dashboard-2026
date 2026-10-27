import { describe, expect, it } from "vitest";
import { fixedNoNegativeZero, tickDecimals, zeroBasedAxis } from "./chartTheme";

describe("zeroBasedAxis", () => {
  it("starts an all-positive axis at 0", () => {
    const { domain, ticks } = zeroBasedAxis([1.6, 2.0, 2.4]);
    expect(domain[0]).toBe(0);
    expect(domain[1]).toBeGreaterThanOrEqual(2.4);
    expect(ticks[0]).toBe(0);
  });

  it("keeps 0 inside an axis that goes negative", () => {
    const { domain, ticks } = zeroBasedAxis([-8.9, 3.2]);
    expect(domain[0]).toBeLessThanOrEqual(-8.9);
    expect(domain[1]).toBeGreaterThanOrEqual(3.2);
    expect(ticks).toContain(0);
  });

  it("ends an all-negative axis at 0", () => {
    const { domain } = zeroBasedAxis([-3, -1]);
    expect(domain[1]).toBe(0);
  });

  it("copes with no values", () => {
    expect(zeroBasedAxis([]).domain[0]).toBe(0);
  });
});

describe("tickDecimals", () => {
  it("adds a decimal place where one place would repeat labels", () => {
    // One measure's relative change: ticks 0.02% apart
    expect(tickDecimals([-0.06, -0.04, -0.02, 0], 1)).toBe(2);
    expect(tickDecimals([0, 0.1, 0.2, 0.3], 1)).toBe(1);
    expect(tickDecimals([0, 20, 40, 60])).toBe(0);
  });
});

describe("fixedNoNegativeZero", () => {
  it("drops the sign of a value that rounds to zero", () => {
    expect(fixedNoNegativeZero(-0.04, 1)).toBe("0.0");
    expect(fixedNoNegativeZero(-0.06, 1)).toBe("-0.1");
  });
});

import { describe, expect, it } from "vitest";
import { zeroBasedAxis } from "./chartTheme";

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

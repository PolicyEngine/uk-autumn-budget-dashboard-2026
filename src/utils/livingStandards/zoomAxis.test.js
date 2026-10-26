import { describe, expect, it } from "vitest";
import { zoomAxis } from "./baseline";

describe("the fitted axis for a level over time", () => {
  it("fits incomes, the Gini and a poverty rate, marking a break when it leaves out 0", () => {
    expect(zoomAxis([38600, 39600, 40400, 42700, 43100])).toEqual({ domain: [36000, 46000], ticks: [36000, 38000, 40000, 42000, 44000, 46000], broken: true });
    expect(zoomAxis([0.302, 0.304, 0.339, 0.327])).toMatchObject({ domain: [0.28, 0.36], broken: true });
    // Steps of 1, 2 or 5 only, so a percentage tick needs no decimal
    const poverty = zoomAxis([11.5, 11.8, 16.0, 17.2]);
    expect(poverty.ticks.every((t) => Number.isInteger(t))).toBe(true);
  });

  it("never goes below 0 for values that are not, and keeps room around a flat line", () => {
    expect(zoomAxis([0.5, 1, 2]).domain[0]).toBe(0);
    expect(zoomAxis([0.5, 1, 2]).broken).toBe(false);
    const flat = zoomAxis([11.8, 11.8]);
    expect(flat.domain[0]).toBeLessThan(11.8);
    expect(flat.domain[1]).toBeGreaterThan(11.8);
  });
});

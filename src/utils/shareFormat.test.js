import { describe, expect, it } from "vitest";
import { formatShare, visibleSegments, MIN_SEGMENT } from "./shareFormat";

describe("formatShare", () => {
  it.each([
    [0, "0%"],
    [0.03, "<0.1%"],
    [0.095, "<0.1%"],
    [0.1, "0.1%"],
    [0.46, "0.5%"],
    [1, "1%"],
    [37.6, "38%"],
    [99.2, "99.2%"],
    [99.95, ">99.9%"],
    [99.97, ">99.9%"],
    [100, "100%"],
  ])("writes %s as %s", (value, text) => {
    expect(formatShare(value)).toBe(text);
  });

  it("never writes 0.0% for a share that is not zero", () => {
    for (const value of [0.001, 0.01, 0.049, 0.05, 0.068]) expect(formatShare(value)).not.toBe("0.0%");
  });
});

describe("visibleSegments", () => {
  it("draws a tiny non-zero share at the minimum width, taken from the largest, and keeps the real shares", () => {
    const row = visibleSegments({ better: 99.9, unchanged: 0.05, worse: 0.05 }, ["better", "unchanged", "worse"]);
    expect(row.worse).toBe(MIN_SEGMENT);
    expect(row.unchanged).toBe(MIN_SEGMENT);
    expect(row.better + row.unchanged + row.worse).toBeCloseTo(100);
    expect(row.real.worse).toBe(0.05);
  });

  it("leaves zero shares at zero", () => {
    const row = visibleSegments({ better: 100, unchanged: 0, worse: 0 }, ["better", "unchanged", "worse"]);
    expect(row.worse).toBe(0);
    expect(row.better).toBe(100);
  });
});

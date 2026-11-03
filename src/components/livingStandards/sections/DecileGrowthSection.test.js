import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { changeWords, pctTick, tightAxis, trendWords } from "./DecileGrowthSection";

describe("tightAxis", () => {
  it("fits each side when values go both ways, never forced symmetric: −0.46 to +0.13 is −0.5 to +0.15 by 0.1s", () => {
    expect(tightAxis([-0.46, 0.13])).toEqual({ domain: [-0.5, 0.15], ticks: [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1] });
  });

  it("starts at 0 when every value has one sign", () => {
    expect(tightAxis([0.1, 0.9])).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(tightAxis([-0.3, -1.4])).toEqual({ domain: [-1.5, 0], ticks: [-1.5, -1, -0.5, 0] });
  });
});

describe("pctTick", () => {
  it("labels each tick to its own precision: 0.25 is 0.25%, never 0.3%", () => {
    expect(tightAxis([0.1, 0.9]).ticks.map(pctTick)).toEqual(["0%", "0.25%", "0.5%", "0.75%", "1%"]);
    expect(pctTick(-0.25)).toBe("-0.25%");
    expect(pctTick(2.5)).toBe("2.5%");
  });
});

describe("the growth sentences", () => {
  it("never says incomes fall at the top beside a 0 there: −0.1 and 0 barely change", () => {
    expect(trendWords(-0.1, 0)).toBe("barely change at either end");
    expect(trendWords(0, 0.1)).toBe("barely change at either end");
  });
  it("keeps the signed wording once an end is clearly away from 0", () => {
    expect(trendWords(-0.4, -0.3)).toBe("fall about as fast at the bottom as at the top");
    expect(trendWords(0.5, 1.2)).toBe("grow faster at the top than at the bottom");
  });
  it("does not call +0.1 and 0 an equal change at both ends", () => {
    expect(changeWords(0.1, 0)).toBe("barely change income growth at either end");
    // A near-zero average with one year past 0.2pp is not "barely" (round 3)
    expect(changeWords(-0.1, -0.1, 0.35)).toBe("change income growth little at either end");
    expect(changeWords(-0.1, -0.1, 0.15)).toBe("barely change income growth at either end");
    expect(changeWords(0.4, 0.3)).toBe("change income growth about equally at both ends");
    expect(changeWords(0.1, 0.6)).toBe("change income growth more at the top");
  });
  it("says more at the end with the larger change by size, not by sign (W6 G1)", () => {
    // The 2031-32 threshold freeze alone, whole period, after housing costs
    expect(changeWords(0, -0.4, 0.4)).toBe("change income growth more at the top");
    expect(changeWords(-0.5, 0.1, 0.5)).toBe("change income growth more at the bottom");
    expect(changeWords(0.3, -0.3, 0.3)).toBe("raise income growth at the bottom and lower it at the top");
    expect(changeWords(-0.2, 0.3, 0.3)).toBe("raise income growth at the top and lower it at the bottom");
  });
  it("never says more at an end whose change is not the larger in size", () => {
    const shown = fc.integer({ min: -30, max: 30 }).map((tenths) => tenths / 10);
    fc.assert(
      fc.property(shown, shown, fc.double({ min: 0, max: 3, noNaN: true }), (bottom, top, largest) => {
        const words = changeWords(bottom, top, largest);
        if (/more at the top/.test(words)) expect(Math.abs(top)).toBeGreaterThan(Math.abs(bottom));
        if (/more at the bottom/.test(words)) expect(Math.abs(bottom)).toBeGreaterThan(Math.abs(top));
        if (/raise income growth at the bottom/.test(words)) expect(bottom > 0 && top < 0).toBe(true);
        if (/raise income growth at the top/.test(words)) expect(top > 0 && bottom < 0).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("an end group's mean effect in the growth sentence", () => {
  it("has two decimals, says under 0.01 for a tiny one, and 0 only for none", async () => {
    const { effectEndText } = await import("./DecileGrowthSection");
    expect(effectEndText(0.031)).toBe("+0.03");
    expect(effectEndText(-0.0249)).toBe("−0.02");
    expect(effectEndText(0.004)).toBe("under 0.01");
    expect(effectEndText(-0.001)).toBe("under 0.01");
    expect(effectEndText(0)).toBe("0");
  });
});

describe("the growth charts leave out the lowest tenth", () => {
  it("says why in one caveat, naming no one", async () => {
    const { LOWEST_TENTH_CAVEAT } = await import("./DecileGrowthSection");
    expect(LOWEST_TENTH_CAVEAT).toBe(
      "The chart leaves out the lowest tenth: survey incomes at the very bottom are often below what those households spend, so their growth is unreliable.",
    );
  });
});

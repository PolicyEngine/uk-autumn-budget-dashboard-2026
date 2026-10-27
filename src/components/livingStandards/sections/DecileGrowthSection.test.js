import { describe, expect, it } from "vitest";
import { pctTick, tightAxis } from "./DecileGrowthSection";

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

import { describe, expect, it } from "vitest";
import { tightAxis } from "./DecileGrowthSection";

describe("tightAxis", () => {
  it("ends close to the data: ±0.47 is ±0.5 in 0.25s, not ±0.75", () => {
    expect(tightAxis([-0.47, 0.2])).toEqual({ domain: [-0.5, 0.5], ticks: [-0.5, -0.25, 0, 0.25, 0.5] });
  });

  it("starts at 0 when every value has one sign", () => {
    expect(tightAxis([0.1, 0.9])).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(tightAxis([-0.3, -1.4])).toEqual({ domain: [-1.5, 0], ticks: [-1.5, -1, -0.5, 0] });
  });
});

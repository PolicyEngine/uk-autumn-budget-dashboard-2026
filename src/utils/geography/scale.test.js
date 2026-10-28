import { describe, expect, it } from "vitest";
import { cleanStepAbove, fittedExtent, scaleColour, scaleLabels, SCALE_COLOURS } from "./scale";

describe("the colour domain fitted to the figures shown", () => {
  it("is ± the 95th percentile of |value|, rounded up to a clean 1-2-5 step", () => {
    // 100 seats from 0.0001% to 0.04% of income, then 5 large outliers
    const values = [...Array.from({ length: 100 }, (_, i) => ((i + 1) * 0.000004).toString()), "-0.0011", "0.002", "0.003", "0.004", "0.005"];
    // The 95th percentile (0.000384 here, under 0.04%) rounds up to 0.05%; outliers clamp
    expect(fittedExtent(values, "relative_change")).toBe(0.0005);
    expect(scaleLabels("relative_change", 0.0005)).toEqual(["−0.05%", "0%", "+0.05%"]);
    expect(scaleColour("0.004", 0.0005)).toBe(scaleColour("1", 0.0005));
    // 0 stays neutral
    expect(scaleColour("0", 0.0005)).toBe(SCALE_COLOURS.neutral);
    // £: 1-2-5 steps from £1
    expect(fittedExtent(["-3", "12", "17", "4"], "average_change")).toBe(20);
    expect(cleanStepAbove(0.00011, "relative_change")).toBe(0.0002);
    expect(cleanStepAbove(0.0001, "relative_change")).toBe(0.0001);
    expect(cleanStepAbove(0.0012, "relative_change")).toBe(0.002);
    expect(cleanStepAbove(51, "average_change")).toBe(100);
    // No figures, or all zero: the fixed ±1% / ±£100
    expect(fittedExtent([], "relative_change")).toBe(0.01);
    expect(fittedExtent(["0", "0"], "average_change")).toBe(100);
  });
});

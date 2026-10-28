import { describe, expect, it } from "vitest";
import { SCALE_COLOURS, colourExtent, scaleColour, scaleLabels } from "./scale";

describe("the map's colour domain", () => {
  it("is fixed in advance, ±0.05% of income or ±£50, clamping beyond it with 0 neutral", () => {
    expect(colourExtent("relative_change")).toBe(0.0005);
    expect(colourExtent("average_change")).toBe(50);
    expect(scaleLabels("relative_change", colourExtent("relative_change"))).toEqual(["−0.05%", "0%", "+0.05%"]);
    expect(scaleLabels("average_change", colourExtent("average_change"))).toEqual(["−£50", "£0", "+£50"]);
    // Beyond the ends: the end colours
    expect(scaleColour("0.004", 0.0005)).toBe(scaleColour("0.0005", 0.0005));
    expect(scaleColour("-120", 50)).toBe(scaleColour("-50", 50));
    expect(scaleColour("0", 0.0005)).toBe(SCALE_COLOURS.neutral);
    // Within: part way (0.05% is half way to teal)
    expect(scaleColour("0.00025", 0.0005)).not.toBe(scaleColour("0.0005", 0.0005));
  });
});

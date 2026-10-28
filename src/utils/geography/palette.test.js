import { describe, expect, it } from "vitest";
import { CATEGORY_COLOURS, NO_DATA_FILL, NO_DATA_STROKE, UNCERTAIN_FILL } from "./palette";
import { SCALE_COLOURS, scaleColour } from "./scale";
import { CHART_COLOURS } from "../chartTheme";
import { TOO_UNCERTAIN } from "./classify";

describe("one grey per meaning in both map views (Pavel's review, MAP1)", () => {
  it("draws little or no change in the scale's £0 grey, and too uncertain in the mid grey", () => {
    expect(CATEGORY_COLOURS.little_change).toBe(SCALE_COLOURS.neutral);
    expect(CATEGORY_COLOURS[TOO_UNCERTAIN]).toBe(UNCERTAIN_FILL);
    expect(CATEGORY_COLOURS.little_change).not.toBe(CATEGORY_COLOURS[TOO_UNCERTAIN]);
  });
});

describe("No data on the map (Vahid, 28 October)", () => {
  it("is a faded grey, never white, and never the scale's 0 grey", () => {
    expect(NO_DATA_FILL).not.toBe(CHART_COLOURS.surface);
    expect(NO_DATA_FILL).not.toBe(SCALE_COLOURS.neutral);
    expect(NO_DATA_FILL.toLowerCase()).not.toBe(scaleColour("0", 0.01).toLowerCase());
    // Cooler than the 0 grey: more blue than red
    const [r, , b] = [1, 3, 5].map((i) => parseInt(NO_DATA_FILL.slice(i, i + 2), 16));
    expect(b - r).toBeGreaterThan(10);
    // The same thin white border as every other seat
    expect(NO_DATA_STROKE).toBe(CHART_COLOURS.surface);
  });
});

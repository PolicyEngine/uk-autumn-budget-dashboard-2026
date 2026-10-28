import { describe, expect, it } from "vitest";
import { CATEGORY_COLOURS, UNCERTAIN_FILL } from "./palette";
import { SCALE_COLOURS } from "./scale";
import { TOO_UNCERTAIN } from "./classify";

describe("one grey per meaning in both map views (Pavel's review, MAP1)", () => {
  it("draws little or no change in the scale's £0 grey, and too uncertain in the mid grey", () => {
    expect(CATEGORY_COLOURS.little_change).toBe(SCALE_COLOURS.neutral);
    expect(CATEGORY_COLOURS[TOO_UNCERTAIN]).toBe(UNCERTAIN_FILL);
    expect(CATEGORY_COLOURS.little_change).not.toBe(CATEGORY_COLOURS[TOO_UNCERTAIN]);
  });
});

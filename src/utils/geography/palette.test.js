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

// CIELAB lightness and distance (D65), to say "clearly apart" in numbers
function lab(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    r * 0.2126 + g * 0.7152 + b * 0.0722,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883,
  ].map(f);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe("No data on the map (Vahid, 28 October)", () => {
  it("is a faint grey, lighter than the scale's 0 grey by a clear margin, and never white", () => {
    expect(NO_DATA_FILL).not.toBe(CHART_COLOURS.surface);
    expect(NO_DATA_FILL).not.toBe(SCALE_COLOURS.neutral);
    // Faded: lighter than the 0 grey, so lighter than every colour on the
    // scale, and apart from it by a visible margin (ΔE76 over 4)
    expect(lab(NO_DATA_FILL)[0] - lab(SCALE_COLOURS.neutral)[0]).toBeGreaterThan(3);
    expect(deltaE(NO_DATA_FILL, SCALE_COLOURS.neutral)).toBeGreaterThan(4);
    expect(deltaE(NO_DATA_FILL, scaleColour("0", 0.01))).toBeGreaterThan(4);
    // Still a fill, not the white card behind the map
    expect(deltaE(NO_DATA_FILL, CHART_COLOURS.surface)).toBeGreaterThan(4);
    // The same thin white border as every other seat
    expect(NO_DATA_STROKE).toBe(CHART_COLOURS.surface);
  });
});

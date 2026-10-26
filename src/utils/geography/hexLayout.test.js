import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSTITUENCY_HEXES, fitHexes, hexCentre } from "./hexLayout";

// The boundaries the site ships: their codes are the codes the results use
const boundaries = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "uk_constituencies_2024.geojson"), "utf-8"),
);
const boundaryCodes = boundaries.features.map((feature) => feature.properties.GSScode);

describe("the constituency hex layout", () => {
  it("has one hex for every 2024 constituency the boundaries hold, and no other", () => {
    expect(boundaryCodes).toHaveLength(650);
    const hexCodes = Object.keys(CONSTITUENCY_HEXES);
    expect(hexCodes.filter((code) => !boundaryCodes.includes(code))).toEqual([]);
    expect(boundaryCodes.filter((code) => !hexCodes.includes(code))).toEqual([]);
  });

  it("gives no two constituencies the same hex", () => {
    const cells = new Set(Object.values(CONSTITUENCY_HEXES).map(([q, r]) => `${q},${r}`));
    expect(cells.size).toBe(650);
  });

  it("shifts odd rows, of either sign, half a hex right", () => {
    expect(hexCentre([0, 1])[0]).toBeCloseTo(Math.sqrt(3) / 2);
    expect(hexCentre([0, -1])[0]).toBeCloseTo(Math.sqrt(3) / 2);
    expect(hexCentre([0, -2])[0]).toBe(0);
    // y grows northward in the layout, downward in SVG
    expect(hexCentre([0, -2])[1]).toBe(3);
  });

  it("fits every hex inside the drawing area, padding kept", () => {
    const { paths, bounds, missing } = fitHexes(boundaryCodes, { width: 800, height: 600, padding: 20 });
    expect(missing).toEqual([]);
    expect(paths.size).toBe(650);
    for (const [[x0, y0], [x1, y1]] of bounds.values()) {
      expect(x0).toBeGreaterThanOrEqual(19.99);
      expect(y0).toBeGreaterThanOrEqual(19.99);
      expect(x1).toBeLessThanOrEqual(780.01);
      expect(y1).toBeLessThanOrEqual(580.01);
    }
  });
});

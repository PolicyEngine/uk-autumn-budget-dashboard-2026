import { describe, expect, it } from "vitest";
import { povertyTileChange, povertyTileLevels } from "./PovertyTiles";

describe("the poverty tiles' words", () => {
  it("lead with the change in points of the values shown", () => {
    expect(povertyTileChange(14.31, 14.28)).toBe("No change");
    expect(povertyTileChange(11.42, 11.51)).toBe("Rises 0.1pp");
    expect(povertyTileChange(12.0, 11.0)).toBe("Falls 1.0pp");
  });

  it("give the levels as the model's estimates", () => {
    expect(povertyTileLevels(14.3, 14.3, "2027-28", "2031-32")).toBe("Model estimate: 14.3% in 2027-28 and 2031-32.");
    expect(povertyTileLevels(11.4, 11.5, "2027-28", "2031-32")).toBe("Model estimate: 11.4% in 2027-28, 11.5% in 2031-32.");
  });
});

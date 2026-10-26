import { describe, expect, it } from "vitest";
import { tooltipShift } from "./infoTooltip";

describe("tooltipShift", () => {
  it("leaves a tooltip inside the viewport where it is", () => {
    expect(tooltipShift(40, 300, 390)).toBe(0);
  });

  it("moves a tooltip off the left edge to 16px in", () => {
    expect(tooltipShift(-60, 200, 390)).toBe(76);
  });

  it("moves a tooltip off the right edge to 16px in", () => {
    expect(tooltipShift(200, 460, 390)).toBe(-86);
  });

  it("keeps the left edge in view when the tooltip is wider than the room", () => {
    expect(tooltipShift(10, 400, 390)).toBe(6);
  });
});

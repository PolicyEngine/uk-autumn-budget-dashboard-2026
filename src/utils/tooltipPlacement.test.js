import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltipPlacement";

const VIEW = { viewportWidth: 1280, viewportHeight: 800, topInset: 112, offset: 12, margin: 8 };

describe("placeTooltip", () => {
  it("puts a tooltip right of and below its anchor when it fits", () => {
    const p = placeTooltip({ ...VIEW, x: 300, y: 300, width: 200, height: 100 });
    expect(p).toMatchObject({ left: 312, top: 312, flippedX: false, flippedY: false, maxHeight: null });
  });

  it("flips left near the right edge", () => {
    const p = placeTooltip({ ...VIEW, x: 1200, y: 300, width: 200, height: 100 });
    expect(p.flippedX).toBe(true);
    expect(p.left).toBe(1200 - 12 - 200);
  });

  it("flips above near the foot of the window", () => {
    const p = placeTooltip({ ...VIEW, x: 300, y: 700, width: 200, height: 300 });
    expect(p.flippedY).toBe(true);
    expect(p.top).toBe(700 - 12 - 300);
    expect(p.top + 300).toBeLessThanOrEqual(800 - 8);
  });

  it("clamps under the sticky band when neither below nor above fits", () => {
    // 20 rows near the foot: 480px tall, 150px below the band to the anchor
    const p = placeTooltip({ ...VIEW, x: 300, y: 250, width: 240, height: 480 });
    expect(p.flippedY).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(112 + 8);
    expect(p.top + 480).toBeLessThanOrEqual(800 - 8);
  });

  it("caps a tooltip taller than the room with a maxHeight", () => {
    const p = placeTooltip({ ...VIEW, x: 300, y: 600, width: 240, height: 900 });
    expect(p.maxHeight).toBe(800 - 8 - (112 + 8));
    expect(p.top).toBe(120);
  });

  it("keeps a pinned box (offset 0) at its corner, or above when it would run off", () => {
    expect(placeTooltip({ ...VIEW, offset: 0, x: 100, y: 400, width: 240, height: 200 })).toMatchObject({ left: 100, top: 400 });
    const p = placeTooltip({ ...VIEW, offset: 0, x: 100, y: 700, width: 240, height: 200 });
    expect(p).toMatchObject({ top: 500, flippedY: true });
  });

  it("stays inside a phone's width, capping a wider tooltip", () => {
    const phone = { viewportWidth: 390, viewportHeight: 844, topInset: 100 };
    const p = placeTooltip({ ...phone, x: 200, y: 400, width: 300, height: 100 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 300).toBeLessThanOrEqual(390 - 8);
    const wide = placeTooltip({ ...phone, x: 200, y: 400, width: 500, height: 100 });
    expect(wide).toMatchObject({ left: 8, maxWidth: 374 });
  });
});

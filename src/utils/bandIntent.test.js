import { describe, expect, it } from "vitest";
import { BAND_HIDE_AFTER_PX, BAND_SHOW_AFTER_PX, createBandIntent, LANDSCAPE_PHONE_QUERY } from "./pageScroll";
import { anchorInWindow } from "../components/ViewportTooltip";

describe("the title band on a phone on its side", () => {
  it("is for short, wide windows only", () => {
    expect(LANDSCAPE_PHONE_QUERY).toBe("(orientation: landscape) and (max-height: 500px)");
  });

  it("tucks away after a scroll down and comes back on a scroll up", () => {
    const band = createBandIntent({ y: 500 });
    expect(band.scroll(510, { top: 100 })).toBeNull();
    expect(band.scroll(500 + BAND_HIDE_AFTER_PX, { top: 100 })).toBe(true);
    expect(band.scroll(900, { top: 100 })).toBe(true);
    expect(band.scroll(900 - BAND_SHOW_AFTER_PX, { top: 100 })).toBe(false);
  });

  it("stays in view near the page's top, while in use, and for the page's own scrolls", () => {
    const band = createBandIntent({ y: 0 });
    expect(band.scroll(80, { top: 100 })).toBe(false);
    expect(band.scroll(400, { top: 100, held: true })).toBe(false);
    expect(band.scroll(800, { top: 100, programmatic: true })).toBeNull();
  });
});

describe("a tooltip whose point has left the window", () => {
  it("is hidden; a pinned box is checked at the point it is for", () => {
    expect(anchorInWindow({ x: 100, y: 200 }, 390, 844)).toBe(true);
    expect(anchorInWindow({ x: 100, y: -5 }, 390, 844)).toBe(false);
    expect(anchorInWindow({ x: 100, y: 900, point: { x: 100, y: 700 } }, 390, 844)).toBe(true);
    expect(anchorInWindow({ x: 100, y: 300, point: { x: 100, y: 900 } }, 390, 844)).toBe(false);
  });
});

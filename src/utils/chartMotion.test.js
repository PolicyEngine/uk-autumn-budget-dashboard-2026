import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_MOTION_MS, chartMotion } from "./chartMotion";
import { PLAY_STEP_MS } from "../components/YearSlider";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubMotion = (reduce) =>
  vi.stubGlobal("matchMedia", (query) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));

describe("chart motion", () => {
  it("tweens over about 850ms, eased in and out", () => {
    stubMotion(false);
    expect(chartMotion()).toEqual({
      isAnimationActive: true,
      animationBegin: 0,
      animationDuration: CHART_MOTION_MS,
      animationEasing: "ease-in-out",
    });
    expect(CHART_MOTION_MS).toBeGreaterThanOrEqual(800);
    expect(CHART_MOTION_MS).toBeLessThanOrEqual(900);
  });

  it("turns animation off for prefers-reduced-motion", () => {
    stubMotion(true);
    expect(chartMotion().isAnimationActive).toBe(false);
  });

  it("gives Play 2 to 2.5s per year, longer than a tween", () => {
    expect(PLAY_STEP_MS).toBeGreaterThanOrEqual(2000);
    expect(PLAY_STEP_MS).toBeLessThanOrEqual(2500);
    expect(PLAY_STEP_MS).toBeGreaterThan(CHART_MOTION_MS);
  });
});

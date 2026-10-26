import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHART_MOTION_MS, MOTION_EASE_OUT, chartMotion, chartTransition } from "./chartMotion";
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
  it("tweens over about 300ms, eased out", () => {
    stubMotion(false);
    expect(chartMotion()).toEqual({
      isAnimationActive: true,
      animationBegin: 0,
      animationDuration: CHART_MOTION_MS,
      animationEasing: "ease-out",
    });
    expect(CHART_MOTION_MS).toBeGreaterThanOrEqual(250);
    expect(CHART_MOTION_MS).toBeLessThanOrEqual(350);
    expect(chartTransition("transform", "width")).toBe(
      `transform ${CHART_MOTION_MS}ms ${MOTION_EASE_OUT}, width ${CHART_MOTION_MS}ms ${MOTION_EASE_OUT}`,
    );
  });

  it("mirrors the --motion-chart and --ease-out tokens, which reduced motion sets to 0ms", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(new RegExp(`--motion-chart: ${CHART_MOTION_MS}ms;`));
    expect(css).toContain(`--ease-out: ${MOTION_EASE_OUT};`);
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/);
    expect(reduced?.[1]).toMatch(/--motion-fast: 0ms;/);
    expect(reduced?.[1]).toMatch(/--motion-base: 0ms;/);
    expect(reduced?.[1]).toMatch(/--motion-chart: 0ms;/);
  });

  it("turns animation off for prefers-reduced-motion", () => {
    stubMotion(true);
    expect(chartMotion().isAnimationActive).toBe(false);
    expect(chartTransition("transform")).toBeUndefined();
  });

  it("gives Play 2 to 2.5s per year, longer than a tween", () => {
    expect(PLAY_STEP_MS).toBeGreaterThanOrEqual(2000);
    expect(PLAY_STEP_MS).toBeLessThanOrEqual(2500);
    expect(PLAY_STEP_MS).toBeGreaterThan(CHART_MOTION_MS);
  });
});

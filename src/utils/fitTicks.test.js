import { describe, expect, it } from "vitest";
import { approxTextWidth, fitTicks } from "./chartTheme";
import { niceRange } from "../components/youngPeople/youngPeopleData";

// £ a year with a true minus, as the dumbbell's axis
const money = (v) => (v < 0 ? `−£${-v}` : `£${v}`);
const TICKS = [-200, 0, 200, 400, 600, 800];
const DOMAIN = [-200, 800];

// The smallest clear space between neighbouring centred labels, in px
function smallestGap(ticks, domain, width, format, fontSize = 12) {
  const x = (v) => ((v - domain[0]) / (domain[1] - domain[0])) * width;
  let gap = Infinity;
  for (let i = 1; i < ticks.length; i += 1) {
    const room = (approxTextWidth(format(ticks[i - 1]), fontSize) + approxTextWidth(format(ticks[i]), fontSize)) / 2;
    gap = Math.min(gap, x(ticks[i]) - x(ticks[i - 1]) - room);
  }
  return gap;
}

describe("fitTicks", () => {
  it("labels every tick in a wide plot", () => {
    expect(fitTicks(TICKS, DOMAIN, 600, money)).toEqual(TICKS);
  });

  it("thins the By age dumbbell's −£200 … £800 in a narrow plot, keeping £0 and the clear end", () => {
    expect(fitTicks(TICKS, DOMAIN, 300, money)).toEqual(TICKS);
    expect(fitTicks(TICKS, DOMAIN, 190, money)).toEqual([-200, 0, 400, 800]);
  });

  it("drops an end that would touch its neighbour", () => {
    expect(fitTicks(TICKS, DOMAIN, 150, money)).toEqual([0, 400, 800]);
  });

  it("always keeps £0, and never lets two labels come closer than 12px", () => {
    for (let width = 40; width <= 900; width += 10) {
      const shown = fitTicks(TICKS, DOMAIN, width, money);
      expect(shown, `width ${width}`).toContain(0);
      if (shown.length > 1) expect(smallestGap(shown, DOMAIN, width, money), `width ${width}`).toBeGreaterThanOrEqual(12 - 1e-9);
    }
  });

  it("labels fewer ticks, never more, as the plot narrows", () => {
    let previous = Infinity;
    for (let width = 900; width >= 40; width -= 10) {
      const count = fitTicks(TICKS, DOMAIN, width, money).length;
      expect(count, `width ${width}`).toBeLessThanOrEqual(previous);
      previous = count;
    }
  });

  it("thins only to round steps (every second or fifth tick, never every third)", () => {
    const ticks = [0, 100, 200, 300, 400, 500, 600];
    for (let width = 40; width <= 600; width += 5) {
      const shown = fitTicks(ticks, [0, 600], width, money).filter((t) => t !== 600);
      const steps = shown.slice(1).map((t, i) => t - shown[i]);
      for (const step of steps) expect([100, 200, 500], `width ${width}`).toContain(step);
    }
  });

  it("passes every tick through until the plot is measured", () => {
    expect(fitTicks(TICKS, DOMAIN, 0, money)).toEqual(TICKS);
  });

  it("keeps a chosen tick other than 0 (100% of the official costing)", () => {
    const pct = (v) => `${v}%`;
    const shown = fitTicks([0, 25, 50, 75, 100, 125, 150], [0, 150], 90, pct, { keep: 100 });
    expect(shown).toContain(100);
  });

  it("with inside ends, counts the last label's full width back from its tick", () => {
    const count = (v) => (v === 0 ? "0" : v.toLocaleString("en-GB"));
    const ticks = [0, 4000, 8000];
    expect(fitTicks(ticks, [0, 8000], 100, count)).toEqual(ticks);
    // Inside, "8,000" ends at its tick and would touch "4,000": dropped
    expect(fitTicks(ticks, [0, 8000], 100, count, { inside: true })).toEqual([0, 8000]);
  });
});

describe("niceRange", () => {
  it("keeps to maxSteps intervals after rounding the ends out", () => {
    const { ticks } = niceRange(-100, 700, { maxSteps: 4 });
    expect(ticks.length - 1).toBeLessThanOrEqual(4);
    expect(ticks).toContain(0);
  });
});

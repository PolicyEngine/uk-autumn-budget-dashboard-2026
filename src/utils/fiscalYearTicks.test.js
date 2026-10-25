import { describe, expect, it } from "vitest";
import { fiscalYearTicks } from "./chartTheme";

describe("fiscalYearTicks", () => {
  const years = [2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031];

  it("labels every year when there is room", () => {
    expect(fiscalYearTicks(years, 1100)).toEqual(years);
  });

  it("thins to every other year, keeping the first, last and base year", () => {
    const ticks = fiscalYearTicks(years, 480, { base: 2027 });
    expect(ticks).toEqual([2021, 2023, 2025, 2027, 2029, 2031]);
  });

  it("never puts a tick right next to the first or last", () => {
    const ticks = fiscalYearTicks(years, 280, { base: 2027 });
    expect(ticks[0]).toBe(2021);
    expect(ticks.at(-1)).toBe(2031);
    expect(ticks).toContain(2027);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i] - ticks[i - 1]).toBeGreaterThan(1);
  });
});

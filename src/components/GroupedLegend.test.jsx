import { describe, expect, it } from "vitest";
import { legendColumns } from "./GroupedLegend";
import { fiscalYearTicks } from "../utils/chartTheme";

describe("legendColumns", () => {
  it("prefers a fuller last row to one more column", () => {
    // Room for 4 columns: 9 entries take 3 (no orphan), 8 take 4
    expect(legendColumns(9, 960)).toBe(3);
    expect(legendColumns(8, 960)).toBe(4);
    expect(legendColumns(10, 960)).toBe(4);
  });

  it("never uses more columns than entries, or than fit", () => {
    expect(legendColumns(3, 1200)).toBe(3);
    // A half-width card: 3 narrower columns rather than an orphan
    expect(legendColumns(9, 490)).toBe(3);
    expect(legendColumns(9, 380)).toBe(1);
    expect(legendColumns(9, 0)).toBe(1);
  });
});

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

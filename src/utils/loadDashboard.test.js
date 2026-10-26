import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { budgetChartData } from "./loadDashboard";

describe("revenue selection completeness", () => {
  it("never turns an absent or held selected measure into zero or a partial total", () => {
    fc.assert(fc.property(
      fc.integer({ min: -100000, max: 100000 }),
      fc.integer({ min: 2026, max: 2031 }),
      (value, year) => {
        const approved = { id: "approved", seriesKey: "measure:approved", displayable: true, years: [year], unsupported_years: [] };
        const held = { id: "held", seriesKey: "measure:held", displayable: false, years: [year], unsupported_years: [] };
        const rows = [{ reform_id: "approved", year, value }, { reform_id: "held", year, value }];
        for (const selected of [["unknown"], ["approved", "unknown"], ["held"], ["approved", "held"]]) {
          const [point] = budgetChartData(rows, [approved, held], selected, [year]);
          expect(point.netImpact).toBeNull();
          expect(point.unpublished).toBe(true);
          if (selected.includes("held")) expect(point[held.seriesKey]).toBeNull();
        }
      },
    ));
  });
});

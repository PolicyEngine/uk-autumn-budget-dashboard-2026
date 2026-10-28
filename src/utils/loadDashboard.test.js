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

describe("the revenue chart's net line", () => {
  const measure = (id) => ({ id, seriesKey: `measure:${id}`, displayable: true, years: [2027], unsupported_years: [] });
  const measures = [measure("a"), measure("b")];
  const rows = [
    { reform_id: "a", year: 2027, value: 1.2 },
    { reform_id: "b", year: 2027, value: -0.5 },
    { reform_id: "pkg", year: 2027, value: 0.6996 },
  ];

  it("is the selected policies' combined run when one is published, the bars' sum kept beside it", () => {
    const [point] = budgetChartData(rows, measures, ["a", "b"], [2027], "pkg");
    expect(point).toMatchObject({ netImpact: 0.6996, netFromPackage: true });
    expect(point.barsSum).toBeCloseTo(0.7, 10);
  });

  it("adds up the bars without one", () => {
    const [point] = budgetChartData(rows, measures, ["a", "b"], [2027]);
    expect(point.netImpact).toBeCloseTo(0.7, 10);
    expect(point.netFromPackage).toBeUndefined();
    // A combined run with no figure that year: the sum
    expect(budgetChartData(rows, measures, ["a", "b"], [2027], "other")[0].netFromPackage).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { changesNothing, offerFor, parseGrowthWithMeasures, seriesFor } from "./growthWithMeasures";

const HEADER =
  "reform_id,reform_name,year,population,basis,grouping,group,baseline_real_median,reform_real_median,baseline_annual_growth,reform_annual_growth,growth_difference";
const csv = (lines) => [HEADER, ...lines].join("\n") + "\n";

// Two years of vigintiles 2 and 20 (no vigintile 1), and a run that changes nothing
const TEXT = csv([
  "pkg,Package,2027,all,bhc,vigintile,2,10000,10100,0.01,0.02,0.01",
  "pkg,Package,2027,all,bhc,vigintile,20,80000,80000,0.0,0.0,0.0",
  "pkg,Package,2028,all,bhc,vigintile,2,10200,10403,0.02,0.03,0.01",
  "pkg,Package,2028,all,bhc,vigintile,20,80800,80800,0.01,0.01,0.0",
  "fuel,Fuel,2027,all,bhc,quintile,1,10000,10000,0.01,0.01,0.0",
  "fuel,Fuel,2028,all,bhc,quintile,1,10100,10100,0.01,0.01,0.0",
]);

describe("income_growth_with_measures.csv", () => {
  it("parses numbers and refuses a file without its columns", () => {
    const rows = parseGrowthWithMeasures(TEXT);
    expect(rows[0]).toMatchObject({ reform_id: "pkg", year: 2027, group: 2, growth_difference: 0.01 });
    expect(() => parseGrowthWithMeasures("a,b\n1,2\n")).toThrow(/missing columns/);
  });

  it("gives the chart's series with vigintile 1 empty, and growth since the first year", () => {
    const rows = parseGrowthWithMeasures(TEXT);
    const s = seriesFor(rows, { reformId: "pkg", population: "all", basis: "bhc", grouping: "vigintile" });
    expect(s.map((r) => r.year)).toEqual(["2027-28", "2028-29"]);
    expect(s[0].real_median).toHaveLength(20);
    expect(s[0].real_median[0]).toBeNull();
    expect(s[1].difference[1]).toBe(0.01);
    expect(s[1].annual[19]).toBe(0.01);
    expect(s[1].cumulative[1]).toBeCloseTo(10403 / 10100 - 1, 10);
    expect(s[1].base_cumulative[1]).toBeCloseTo(10200 / 10000 - 1, 10);
    expect(s[0].cumulative[1]).toBe(0);
  });

  it("offers what a run has, and knows a run that moves nothing", () => {
    const rows = parseGrowthWithMeasures(TEXT);
    expect(offerFor(rows, "pkg")).toEqual({ groupings: ["vigintile"], populations: ["all"], bases: ["bhc"] });
    expect(changesNothing(rows, "fuel")).toBe(true);
    expect(changesNothing(rows, "pkg")).toBe(false);
    expect(changesNothing(rows, "missing")).toBe(false);
    expect(seriesFor(rows, { reformId: "missing", population: "all", basis: "bhc", grouping: "decile" })).toBeNull();
  });
});

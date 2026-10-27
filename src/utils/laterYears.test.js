import { describe, expect, it, vi } from "vitest";

// Every row displayable except the ones a test marks as held back
const held = new Set();
vi.mock("./measureCatalogue", () => ({
  isCatalogueRowDisplayable: (_catalogue, id, year) => !held.has(`${id}:${year}`),
}));

const { laterDecileEnds } = await import("./laterYears");

const catalogue = { displayable: [{ id: "a" }, { id: "b" }] };
const row = (id, year, decile, value) => ({ reform_id: id, year: String(year), decile, value: String(value) });
const rows = [
  // 2027: both measures; 2028: a and b; 2029: b has no 10th-decile row
  row("a", 2027, "1st", 0.3), row("b", 2027, "1st", 0.1), row("a", 2027, "10th", 0.2), row("b", 2027, "10th", -0.1),
  row("a", 2028, "1st", 0.1), row("b", 2028, "1st", -0.3), row("a", 2028, "10th", 0.1), row("b", 2028, "10th", -0.4),
  row("a", 2029, "1st", 0.1), row("b", 2029, "1st", 0.1), row("a", 2029, "10th", 0.1),
];
const options = { valueKey: "value", ends: ["1st", "10th"], selectedPolicies: ["a", "b"], catalogue, selectedYear: 2027, years: [2027, 2028, 2029] };

describe("laterDecileEnds", () => {
  it("sums the selected measures' ends in each later year", () => {
    const out = laterDecileEnds(rows, options);
    expect(out).toHaveLength(1);
    expect(out[0].year).toBe(2028);
    expect(out[0].yearLabel).toBe("2028-29");
    expect(out[0].low).toBeCloseTo(-0.2);
    expect(out[0].high).toBeCloseTo(-0.3);
  });

  it("leaves out a year where a selected measure has no row, never reading it as zero", () => {
    expect(laterDecileEnds(rows, { ...options, selectedYear: 2028 })).toEqual([]);
  });

  it("leaves out a year whose rows are held back by the catalogue", () => {
    held.add("b:2028");
    try {
      expect(laterDecileEnds(rows, options)).toEqual([]);
    } finally {
      held.clear();
    }
  });

  it("reads nothing when a selected measure is not displayable", () => {
    expect(laterDecileEnds(rows, { ...options, selectedPolicies: ["a", "c"] })).toEqual([]);
    expect(laterDecileEnds([], options)).toEqual([]);
  });

  it("reads the £ table's own column and decile labels", () => {
    const pounds = [
      { reform_id: "a", year: "2028", decile: "1", avg_change: "-40" },
      { reform_id: "a", year: "2028", decile: "10", avg_change: "-300" },
      { reform_id: "a", year: "2028", decile: "all", avg_change: "-100" },
    ];
    const out = laterDecileEnds(pounds, { ...options, valueKey: "avg_change", ends: ["1", "10"], selectedPolicies: ["a"] });
    expect(out).toEqual([{ year: 2028, yearLabel: "2028-29", low: -40, high: -300 }]);
  });
});

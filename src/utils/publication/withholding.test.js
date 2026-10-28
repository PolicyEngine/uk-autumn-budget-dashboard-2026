import { describe, expect, it } from "vitest";
import { withholdingProblems } from "./withholding";

const floor = {
  withheld_cells: [
    { table: "distributional_impact", year: 2027, groups: ["1"] },
    { table: "winners_losers", year: 2027, groups: ["1", "all"] },
  ],
};
const tables = {
  distributional_impact: [{ reform_id: "m", reform_name: "M", year: 2027, decile: "1st", value: null }],
  winners_losers: ["1", "all"].map((decile) => ({ reform_id: "m", reform_name: "M", year: 2027, decile, avg_change: null })),
};

describe("withholdingProblems", () => {
  it("accepts nulls only in the rows the receipt withholds", () => {
    expect(withholdingProblems(tables, floor)).toEqual([]);
    expect(withholdingProblems(tables, {})).toContain("distributional_impact 2027 1 is blank without a recorded withholding");
  });

  it("refuses a published value, including zero, in any withheld row", () => {
    const changed = structuredClone(tables);
    changed.winners_losers[1].avg_change = 0;
    expect(withholdingProblems(changed, floor)).toContain("winners_losers 2027 all publishes a value in a withheld cell");
  });

  it("requires the all complement and every withheld identifying row", () => {
    const changed = structuredClone(floor);
    changed.withheld_cells[1].groups = ["1"];
    expect(withholdingProblems(tables, changed)).toContain("winners_losers 2027 all must be withheld too");
    expect(withholdingProblems({}, floor)).toContain("distributional_impact 2027 1: withheld row is missing");
    expect(withholdingProblems({}, floor, { partial: true })).toEqual([]);
  });

  it.each([null, {}, [null], [{ table: "metrics", year: 2027, groups: ["1"] }]])("refuses malformed recorded cells %s", (cells) => {
    expect(withholdingProblems({}, { withheld_cells: cells }).length).toBeGreaterThan(0);
  });
});

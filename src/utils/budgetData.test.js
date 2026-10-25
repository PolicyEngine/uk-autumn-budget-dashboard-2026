import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBudgetData } from "./budgetData";
import { DISPLAY_YEARS } from "./displayYears";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];

describe("the revenue chart's points", () => {
  it("carry 2031-32 when the file has it, never 'not yet published'", () => {
    const rows = [
      { reform_id: "two_child_limit", year: "2030", value: "-3" },
      { reform_id: "two_child_limit", year: "2031", value: "-3.5" },
      { reform_id: "rail_fares_freeze", year: "2031", value: "-0.5" },
    ];
    const data = buildBudgetData(rows, POLICIES, ["two_child_limit", "rail_fares_freeze"]);
    expect(data.map((point) => point.year)).toEqual([...DISPLAY_YEARS]);
    const p2031 = data.find((point) => point.year === 2031);
    expect(p2031.unpublished).toBeUndefined();
    expect(p2031.netImpact).toBeCloseTo(-4);
    expect(p2031["2 child limit repeal"]).toBe(-3.5);
  });

  it("mark a year the file does not cover as unpublished, not zero", () => {
    const rows = [{ reform_id: "two_child_limit", year: "2030", value: "-3" }];
    const data = buildBudgetData(rows, POLICIES, ["two_child_limit"]);
    expect(data.find((point) => point.year === 2031)).toEqual({
      year: 2031,
      netImpact: null,
      unpublished: true,
    });
  });

  it("count only selected policies, keeping every policy key", () => {
    const rows = [
      { reform_id: "two_child_limit", year: "2031", value: "-3" },
      { reform_id: "rail_fares_freeze", year: "2031", value: "-1" },
    ];
    const p2031 = buildBudgetData(rows, POLICIES, ["rail_fares_freeze"]).find(
      (point) => point.year === 2031,
    );
    expect(p2031["2 child limit repeal"]).toBe(0);
    expect(p2031.netImpact).toBe(-1);
  });

  it("publish every shown year from the shipped budgetary_impact.csv", () => {
    const [header, ...lines] = readFileSync("public/data/budgetary_impact.csv", "utf8")
      .trim()
      .split("\n");
    const keys = header.split(",");
    const rows = lines.map((line) =>
      Object.fromEntries(line.split(",").map((value, i) => [keys[i], value])),
    );
    const data = buildBudgetData(rows, POLICIES, POLICIES.map((p) => p.id));
    expect(data.filter((point) => point.unpublished)).toEqual([]);
  });
});

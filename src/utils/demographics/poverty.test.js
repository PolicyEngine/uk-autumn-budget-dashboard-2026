import { describe, expect, it } from "vitest";
import { POVERTY_COLUMNS, PovertyTableError, parsePovertyTable } from "./poverty";
import { hasReform, rowsFor } from "../geography/rows";
import { POVERTY_CSV } from "../../test/demographicsFixture";

const HEADER = POVERTY_COLUMNS.join(",");

function rejection(text) {
  try {
    parsePovertyTable(text);
  } catch (error) {
    expect(error).toBeInstanceOf(PovertyTableError);
    return error.message;
  }
  throw new Error("the table was accepted");
}

describe("parsePovertyTable", () => {
  it("reads every row, keeping the published rates", () => {
    const table = parsePovertyTable(POVERTY_CSV);
    expect(table.reforms).toEqual(["autumn_budget_2026_combined", "two_child_limit"]);
    expect(hasReform(table, "two_child_limit")).toBe(true);
    const rows = rowsFor(table, { reform: "two_child_limit", year: 2029 });
    expect(rows.map((row) => row.ageGroup)).toEqual(["child", "adult", "senior"]);
    expect(rows[0]).toMatchObject({
      reform: "two_child_limit",
      year: 2029,
      ageGroup: "child",
      baselineRate: "18.4",
      reformRate: "15.9",
      changePp: "-2.5",
    });
  });

  it("requires exactly the published columns", () => {
    expect(rejection("reform,year,age_group,baseline_rate,reform_rate\n")).toMatch(
      /missing change_pp/,
    );
    expect(rejection(`${HEADER},count\n`)).toMatch(/unexpected "count"/);
  });

  it("accepts only policyengine.py's age groups", () => {
    expect(rejection(`${HEADER}\ntwo_child_limit,2029,AGE_0_17,1.0,1.0,0.0`)).toMatch(
      /row 1: age_group .* is not one of child, adult, senior/,
    );
  });

  it("rejects a rate that is not a percentage, never reading a blank as zero", () => {
    expect(rejection(`${HEADER}\ntwo_child_limit,2029,child,,15.9,-2.5`)).toMatch(
      /row 1: baseline_rate is not a number/,
    );
    expect(rejection(`${HEADER}\ntwo_child_limit,2029,child,180.0,15.9,-164.1`)).toMatch(
      /row 1: baseline_rate is not between 0 and 100/,
    );
  });

  it("rejects a change that is not the difference of the rates", () => {
    expect(rejection(`${HEADER}\ntwo_child_limit,2029,child,18.4,15.9,2.5`)).toMatch(
      /row 1: change_pp is not reform_rate minus baseline_rate/,
    );
  });

  it("rejects two rows for one reform, year and age group", () => {
    const row = "two_child_limit,2029,child,18.4,15.9,-2.5";
    expect(rejection(`${HEADER}\n${row}\n${row}`)).toMatch(/row 2: a second row/);
  });

  it("never quotes a figure in a message", () => {
    const message = rejection(`${HEADER}\ntwo_child_limit,2029,child,18.4,15.9,7.25`);
    expect(message).not.toMatch(/7\.25|18\.4|15\.9/);
  });
});

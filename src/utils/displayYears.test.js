import { describe, expect, it } from "vitest";
import budgetYears from "../uk_budget_data/budget_years.json";
import {
  DEFAULT_DISPLAY_YEAR,
  DISPLAY_YEARS,
  FIRST_DISPLAY_YEAR,
  displayRows,
  displayYearOr,
  displayYears,
  isDisplayYear,
  isPublishedYear,
} from "./displayYears";

describe("display years", () => {
  it("come from budget_years.json, from 2027-28", () => {
    expect(FIRST_DISPLAY_YEAR).toBe(2027);
    expect(DISPLAY_YEARS).toEqual(
      budgetYears.policy_years.filter((year) => year >= 2027),
    );
    expect(DISPLAY_YEARS).toEqual([2027, 2028, 2029, 2030, 2031]);
  });

  it("tell a year the files cover from one they do not yet", () => {
    const rows = [{ year: "2030", value: "1" }];
    expect(isPublishedYear(rows, 2030)).toBe(true);
    expect(isPublishedYear(rows, 2031)).toBe(false);
    expect(isPublishedYear(null, 2030)).toBe(false);
  });

  it("drop 2026-27 and anything outside the data, keeping order", () => {
    expect(displayYears([2026, 2027, 2028, 2029, 2030])).toEqual([
      2027, 2028, 2029, 2030,
    ]);
    expect(displayYears([2032, 2025, 2029])).toEqual([2029]);
    expect(isDisplayYear("2028")).toBe(true);
    expect(isDisplayYear("2026")).toBe(false);
    expect(isDisplayYear("all")).toBe(false);
  });

  it("filter rows by their year field, numeric or string", () => {
    const rows = [
      { year: "2026", value: 1 },
      { year: 2027, value: 2 },
      { year: "2030", value: 3 },
    ];
    expect(displayRows(rows).map((row) => row.value)).toEqual([2, 3]);
  });

  it("fall back to the default year for 2026 or a bad value", () => {
    expect(displayYearOr(2026)).toBe(DEFAULT_DISPLAY_YEAR);
    expect(displayYearOr("2026")).toBe(DEFAULT_DISPLAY_YEAR);
    expect(displayYearOr("x")).toBe(DEFAULT_DISPLAY_YEAR);
    expect(displayYearOr(undefined)).toBe(DEFAULT_DISPLAY_YEAR);
    expect(displayYearOr("2028")).toBe(2028);
  });
});

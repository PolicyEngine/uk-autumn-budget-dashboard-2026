import { describe, expect, it } from "vitest";
import { DEFAULT_YEAR_RANGE, defaultRange } from "./yearRange";

describe("defaultRange", () => {
  const years = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31", "2031-32"];

  it("opens every card on 2027-28 to 2031-32", () => {
    expect(DEFAULT_YEAR_RANGE).toEqual(["2027-28", "2031-32"]);
    expect(defaultRange(years)).toEqual(["2027-28", "2031-32"]);
  });

  it("falls back to a card's own ends when it lacks a default year", () => {
    expect(defaultRange(["2028-29", "2029-30", "2030-31"])).toEqual(["2028-29", "2030-31"]);
    expect(defaultRange(["2027-28", "2028-29", "2029-30"])).toEqual(["2027-28", "2029-30"]);
  });
});

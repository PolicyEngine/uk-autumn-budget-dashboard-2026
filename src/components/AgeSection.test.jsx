import { describe, expect, it } from "vitest";
import { ageGroupFrom, ageWindow, groupAges, groupSubject, AGE_GROUP_OPTIONS } from "../utils/ageGroups";
import { oldAgeSubGroup } from "../App";

describe("By age's age groups", () => {
  it("offers every band, pensioners and all ages, and reads ?age= with 16 to 24 as the default", () => {
    expect(AGE_GROUP_OPTIONS.map((group) => group.key)).toEqual(["0-15", "16-24", "25-34", "35-49", "50-64", "65+", "pensioners", "all"]);
    expect(ageGroupFrom("pensioners")).toBe("pensioners");
    expect(ageGroupFrom("nonsense")).toBe("16-24");
    expect(ageGroupFrom(null)).toBe("16-24");
  });

  it("names each group as a sentence's subject", () => {
    expect(groupSubject("16-24")).toBe("16 to 24-year-olds");
    expect(groupSubject("0-15")).toBe("Under-16s");
    expect(groupSubject("65+")).toBe("People aged 65 and over");
    expect(groupSubject("pensioners")).toBe("Pensioners");
  });

  it("gives each group its ages and a window around them for the single-year chart", () => {
    expect(groupAges("16-24", 2027)).toEqual([16, 24]);
    expect(groupAges("pensioners", 2026)).toEqual([66, 90]);
    expect(groupAges("pensioners", 2027)).toEqual([67, 90]);
    expect(ageWindow("16-24", 2027)).toEqual([6, 34]);
    expect(ageWindow("pensioners", 2027)).toEqual([55, 90]);
    expect(ageWindow("all", 2027)).toEqual([0, 90]);
  });

  it("turns the old Young people and Pensioners sub-tab links into By age with the group chosen", () => {
    expect(oldAgeSubGroup({ search: "?sub=young" })).toBe("16-24");
    expect(oldAgeSubGroup({ search: "?tab=dashboard&sub=pensioners" })).toBe("pensioners");
    expect(oldAgeSubGroup({ search: "?sub=age" })).toBeNull();
  });
});

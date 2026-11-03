import { describe, expect, it } from "vitest";
import { sharesBySingleAge } from "./youngPeopleData";
import { groupAges } from "../../utils/ageGroups";

const POLICIES = [{ id: "a" }, { id: "b" }];
const row = (reform_id, age_band, sample_size = 500) => ({
  reform_id,
  year: 2027,
  age_band,
  sample_size,
  pct_better_off: 60,
  pct_unchanged: 30,
  pct_worse_off: 10,
});
const ROWS = [
  ...Array.from({ length: 90 }, (_, age) => row("package", String(age), age === 50 ? 40 : 500)),
  row("package", "90+"),
  // A single's rows, never added up into the package's view
  row("a", "20"),
];

describe("Winners and losers by single year of age (Pavel's review, AGE5 and AGE10)", () => {
  it("covers the chosen group's own ages: 16 to 24 is 16 to 24", () => {
    const shares = sharesBySingleAge(ROWS, POLICIES, ["a", "b"], 2027, "package", groupAges("16-24", 2027));
    expect(shares.groups.map((group) => group.label)).toEqual(["16", "17", "18", "19", "20", "21", "22", "23", "24"]);
  });

  it("covers every age, 0 to 90 and over, for all ages, a thin age suppressed", () => {
    const shares = sharesBySingleAge(ROWS, POLICIES, ["a", "b"], 2027, "package", groupAges("all", 2027));
    expect(shares.groups).toHaveLength(91);
    expect(shares.groups.at(-1).label).toBe("90+");
    expect(shares.groups.find((group) => group.age === 50).suppressed).toBe(true);
  });

  it("reads the whole selection's run only, never the singles", () => {
    expect(sharesBySingleAge(ROWS, POLICIES, ["a", "b"], 2027, null, [16, 24])).toBeNull();
    const shares = sharesBySingleAge(ROWS, POLICIES, ["a", "b"], 2027, "package", [20, 20]);
    expect(shares.run).toBe("package");
  });
});

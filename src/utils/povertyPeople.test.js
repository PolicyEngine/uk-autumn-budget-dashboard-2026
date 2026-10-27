import { describe, expect, it } from "vitest";
import { outlookPopulation, peopleInPovertyText } from "./povertyPeople";

describe("peopleInPovertyText", () => {
  it("turns a change in percentage points into people, to the nearest thousand", () => {
    // −0.0075pp of 70 million is 5,250 people
    expect(peopleInPovertyText(-0.0075, 70)).toBe("about 5,000 fewer people in poverty");
    expect(peopleInPovertyText(0.02, 14.5, "children")).toBe("about 3,000 more children in poverty");
    expect(peopleInPovertyText(-0.001, 70)).toBe("under 1,000 fewer people in poverty");
  });

  it("says nothing without a population or a change", () => {
    expect(peopleInPovertyText(-0.01, null)).toBeNull();
    expect(peopleInPovertyText(0, 70)).toBeNull();
  });
});

describe("outlookPopulation", () => {
  const outlook = {
    deep_poverty: { projection: { below_40pc_median_ahc: [{ year: "2027-28", rate: 0.08, people_millions: 5.6 }] } },
    child_poverty_by_family: { children_millions: { all: [{ year: "2027-28", value: 14.5 }] } },
  };

  it("reads all people (people / rate) and children by fiscal year", () => {
    const population = outlookPopulation(outlook);
    expect(population(2027, "all")).toBeCloseTo(70);
    expect(population(2027, "children")).toBe(14.5);
  });

  it("gives no number for a year the outlook does not cover, or no outlook", () => {
    expect(outlookPopulation(outlook)(2026, "all")).toBeNull();
    expect(outlookPopulation(null)).toBeNull();
  });
});

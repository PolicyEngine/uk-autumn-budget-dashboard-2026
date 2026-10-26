import { describe, expect, it } from "vitest";
import { COMBINED_REFORM_ID } from "./policyConfig";
import {
  curveOf,
  describePosition,
  distributionRunFor,
  equivalenceFactor,
  householdPosition,
  ordinal,
  parseDistribution,
  percentileOn,
} from "./incomePosition";

const CSV = [
  "reform_id,reform_name,year,side,percentile,equivalised_net_income",
  'm,"A measure, quoted",2027,baseline,5,10000',
  'm,"A measure, quoted",2027,baseline,50,30000',
  'm,"A measure, quoted",2027,baseline,95,90000',
  'm,"A measure, quoted",2027,reform,5,10100',
  'm,"A measure, quoted",2027,reform,50,30100',
  'm,"A measure, quoted",2027,reform,95,90100',
  "",
].join("\r\n");

describe("equivalenceFactor", () => {
  it("weighs the HBAI modified OECD scale by age", () => {
    expect(equivalenceFactor({ has_partner: false, children: [] })).toBeCloseTo(0.67);
    // A couple is 1
    expect(equivalenceFactor({ has_partner: true, children: [] })).toBeCloseTo(1);
    // Children under 14 weigh 0.2, from 14 (adult or dependent child) 0.33
    expect(equivalenceFactor({ has_partner: true, children: [{ age: 3 }, { age: 13 }, { age: 14 }, { age: 18 }] })).toBeCloseTo(
      1 + 0.2 + 0.2 + 0.33 + 0.33,
    );
  });
});

describe("parseDistribution and curveOf", () => {
  it("reads one side's curve in percentile order", () => {
    const rows = parseDistribution(CSV);
    expect(rows).toHaveLength(6);
    expect(curveOf(rows, { reformId: "m", year: 2027, side: "reform" })).toEqual([
      { percentile: 5, income: 10100 },
      { percentile: 50, income: 30100 },
      { percentile: 95, income: 90100 },
    ]);
    expect(curveOf(rows, { reformId: "m", year: 2028, side: "reform" })).toEqual([]);
  });
});

describe("percentileOn", () => {
  const curve = [
    { percentile: 5, income: 10000 },
    { percentile: 50, income: 30000 },
    { percentile: 95, income: 90000 },
  ];
  it("interpolates between points", () => {
    // £20,000 is halfway from the 5th (£10,000) to the 50th (£30,000)
    expect(percentileOn(curve, 20000).percentile).toBeCloseTo(27.5);
  });
  it("says when an income is off the published range", () => {
    expect(percentileOn(curve, 5000)).toEqual({ percentile: null, below: true, above: false });
    expect(percentileOn(curve, 100000)).toEqual({ percentile: null, below: false, above: true });
    expect(describePosition(percentileOn(curve, 100000))).toBe("the top 5%");
    expect(describePosition(percentileOn(curve, 5000))).toBe("the bottom 5%");
  });
});

describe("householdPosition", () => {
  const rows = parseDistribution(CSV);
  const before = curveOf(rows, { reformId: "m", year: 2027, side: "baseline" });
  const after = curveOf(rows, { reformId: "m", year: 2027, side: "reform" });

  it("ranks before on the curve before and after on the curve after", () => {
    // A single adult: £20,100 / 0.67 = £30,000 before, the 50th on the
    // curve before. £20,167 / 0.67 = £30,100 after, the 50th on the curve
    // after: everyone gained £100, so the position does not change.
    const position = householdPosition({
      net: { before: 20100, after: 20167 },
      household: { has_partner: false, children: [] },
      before,
      after,
    });
    expect(position.incomeBefore).toBeCloseTo(30000);
    expect(position.incomeAfter).toBeCloseTo(30100);
    expect(position.before.percentile).toBeCloseTo(50);
    expect(position.after.percentile).toBeCloseTo(50);
    expect(position.unchanged).toBe(true);
    expect(position.pointChange).toBe(0);
  });

  it("moves up when the household gains more than the curve shifts", () => {
    // A couple: £30,000 before (50th); £32,100 after, £2,000 above the
    // curve after's 50th, a third of the way to its 95th: 50 + 45 * 2000 / 60000 = 51.5
    const position = householdPosition({
      net: { before: 30000, after: 32100 },
      household: { has_partner: true, children: [] },
      before,
      after,
    });
    expect(position.after.percentile).toBeCloseTo(51.5);
    expect(position.pointChange).toBe(2);
    expect(position.unchanged).toBe(false);
  });
});

describe("distributionRunFor", () => {
  const all = ["a", "b", "c"];
  it("uses a single measure's own run", () => {
    expect(distributionRunFor(["b"], all)).toEqual({ reformId: "b", exact: true });
  });
  it("uses the package's run for every measure, exactly", () => {
    expect(distributionRunFor(["c", "a", "b"], all)).toEqual({ reformId: COMBINED_REFORM_ID, exact: true });
  });
  it("maps part of the package to the package's run, flagged", () => {
    expect(distributionRunFor(["a", "b"], all)).toEqual({ reformId: COMBINED_REFORM_ID, exact: false });
  });
});

describe("ordinal", () => {
  it("names percentiles", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 47].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "47th",
    ]);
  });
});

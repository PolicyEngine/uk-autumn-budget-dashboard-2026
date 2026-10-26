import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  COMBINED_REFORM_ID,
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
    expect(percentileOn(curve, 5000)).toEqual({ percentile: null, below: true, above: false, edge: 5 });
    expect(percentileOn(curve, 100000)).toEqual({ percentile: null, below: false, above: true, edge: 95 });
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
    expect(distributionRunFor(["b"], all, all)).toEqual({ reformId: "b", exact: true });
  });
  it("uses the package's run for every measure, exactly", () => {
    expect(distributionRunFor(["c", "a", "b"], all, ["b", "c", "a"])).toEqual({ reformId: COMBINED_REFORM_ID, exact: true });
  });
  it("maps part of the package to the package's run, flagged", () => {
    expect(distributionRunFor(["a", "b"], all, all)).toEqual({ reformId: COMBINED_REFORM_ID, exact: false });
  });
  it("never calls the package's run exact after a withdrawal: it still holds the withdrawn measure", () => {
    // "d" withdrawn: three published, the package run with all four
    expect(distributionRunFor(["a", "b", "c"], all, ["a", "b", "c", "d"])).toEqual({ reformId: COMBINED_REFORM_ID, exact: false });
    // or no verified package at all
    expect(distributionRunFor(["a", "b", "c"], all, null)).toEqual({ reformId: COMBINED_REFORM_ID, exact: false });
  });
  it("is exact for two or more measures only when the selection, the published set and the package's members are one set", () => {
    const id = fc.constantFrom("a", "b", "c", "d", "e");
    fc.assert(
      fc.property(fc.uniqueArray(id), fc.uniqueArray(id), fc.option(fc.uniqueArray(id), { nil: null }), (selected, published, members) => {
        fc.pre(selected.length > 1);
        const { exact } = distributionRunFor(selected, published, members);
        const same = (x, y) => x.length === y.length && x.every((v) => y.includes(v));
        expect(exact).toBe(published.length > 0 && members !== null && same(selected, published) && same(members, published));
      }),
    );
  });
});

describe("ordinal", () => {
  it("names percentiles", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 47].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "47th",
    ]);
  });
});

import { bandEdges, bandShares, decileAverages, decileOf } from "./incomePosition";

describe("bandShares", () => {
  const curve = [
    { percentile: 5, income: 10000 },
    { percentile: 50, income: 30000 },
    { percentile: 95, income: 90000 },
  ];
  it("splits people into round bands inside the published range", () => {
    expect(bandEdges(curve, 20000)).toEqual([20000, 40000, 60000, 80000]);
    // 20k is the 27.5th, 40k the 57.5th, 60k the 72.5th, 80k the 87.5th
    const shares = bandShares(curve, [20000, 40000, 60000, 80000]);
    expect(shares.map((s) => Math.round(s * 1000) / 10)).toEqual([30, 15, 15]);
  });
});

describe("decileOf", () => {
  it("reads a decile from a percentile or the end it is off", () => {
    expect(decileOf({ percentile: 9.9, below: false, above: false })).toBe(1);
    expect(decileOf({ percentile: 29.6, below: false, above: false })).toBe(3);
    expect(decileOf({ percentile: null, below: true, above: false })).toBe(1);
    expect(decileOf({ percentile: null, below: false, above: true })).toBe(10);
  });
});

describe("decileAverages", () => {
  const rows = ["a", "b"].flatMap((id, k) =>
    [...Array.from({ length: 10 }, (_, i) => String(i + 1)), "all"].map((decile) => ({
      reform_id: id,
      year: "2027",
      decile,
      avg_change: String((k + 1) * 10),
    })),
  );
  it("adds up the selected measures, as the decile charts do", () => {
    expect(decileAverages(rows, ["a", "b"], 2027)[3]).toBe(30);
    expect(decileAverages(rows, ["a"], 2027)[10]).toBe(10);
    expect(decileAverages(rows, ["a"], 2028)).toBeNull();
  });
});

import { decilePercents, logEdges, overallAverage } from "./incomePosition";

describe("decilePercents and overallAverage", () => {
  const names = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  const pct = ["a", "b"].flatMap((id, k) => names.map((decile) => ({ reform_id: id, year: "2027", decile, value: String((k + 1) * 0.1) })));
  const wl = ["a", "b"].map((id, k) => ({ reform_id: id, year: "2027", decile: "all", avg_change: String((k + 1) * 50) }));
  it("adds up the selected measures", () => {
    expect(decilePercents(pct, ["a", "b"], 2027)[10]).toBeCloseTo(0.3);
    expect(decilePercents(pct, ["a"], 2028)).toBeNull();
    expect(overallAverage(wl, ["a", "b"], 2027)).toBe(150);
    expect(overallAverage(wl, ["c"], 2027)).toBeNull();
  });
});

describe("logEdges", () => {
  it("spaces edges evenly on a log scale", () => {
    expect(logEdges(1000, 100000, 2).map(Math.round)).toEqual([1000, 10000, 100000]);
  });
});

import { mobilityOf } from "./incomePosition";

describe("mobilityOf", () => {
  it("reads one run's shares, blank as null", () => {
    const rows = [
      { reform_id: "m", year: "2027", unit: "percentile", start_decile: "all", pct_up: "0.4", pct_down: "0.1", pct_same: "99.5" },
      { reform_id: "m", year: "2027", unit: "percentile", start_decile: "1", pct_up: "", pct_down: "0.2", pct_same: "" },
      { reform_id: "m", year: "2027", unit: "decile", start_decile: "all", pct_up: "0.1", pct_down: "0", pct_same: "99.9" },
    ];
    expect(mobilityOf(rows, { reformId: "m", year: 2027, unit: "percentile" })).toEqual({
      all: { up: 0.4, down: 0.1, same: 99.5 },
      1: { up: null, down: 0.2, same: null },
    });
    expect(mobilityOf(rows, { reformId: "m", year: 2028, unit: "decile" })).toBeNull();
  });
});

import { positionSummary } from "./incomePosition";

describe("positionSummary", () => {
  const at = (percentile) => ({ percentile, below: false, above: false });
  const chip = (summary, key) => summary.chips.find((c) => c.key === key).value;

  it("says how many have a lower income in the middle, each fact once", () => {
    const s = positionSummary({ before: at(11.7), after: at(11.8) }, 87.84, 18778.1);
    expect(s.headline).toBe("12 in every 100 people in the UK have a lower income than you.");
    const m = positionSummary({ before: at(29.2), after: at(29.6) }, 167.2, 25600);
    expect(m.headline).toBe("30 in every 100 people in the UK have a lower income than you.");
    expect(chip(m, "change")).toBe("+£167 a year");
    expect(chip(m, "share")).toBe("+0.65%");
    expect(chip(m, "place")).toBe("29th → 30th percentile");
  });

  it("names the top and the bottom without a stray 'at in'", () => {
    const top = { percentile: null, below: false, above: true, edge: 99 };
    const s = positionSummary({ before: top, after: top }, 87.84, 70000);
    expect(s.headline).toBe("You're in the top 1% of UK incomes.");
    expect(chip(s, "place")).toBe("unchanged (top 1%)");
    const bottom = { percentile: null, below: true, above: false, edge: 1 };
    const b = positionSummary({ before: bottom, after: at(1.4) }, -20, 5000);
    // The same whole percentile as the tile's "1st percentile" (not 2%)
    expect(b.headline).toBe("You're in the bottom 1% of UK incomes.");
    expect(chip(b, "change")).toBe("−£20 a year");
    expect(chip(b, "share")).toBe("−0.40%");
    expect(chip(b, "place")).toBe("bottom 1% → 1st percentile");
    const high = positionSummary({ before: at(96.2), after: at(96.2) }, 0, 90000);
    expect(high.headline).toBe("You're in the top 4% of UK incomes.");
    expect(chip(high, "change")).toBe("£0 a year");
    expect(chip(high, "place")).toBe("unchanged (96th percentile)");
    // 6.3%: "bottom 6%" and "6th percentile", never 7% beside 6th
    const six = positionSummary({ before: at(6.3), after: at(6.3) }, 10, 9000);
    expect(six.headline).toBe("You're in the bottom 6% of UK incomes.");
    expect(chip(six, "place")).toBe("unchanged (6th percentile)");
  });
});

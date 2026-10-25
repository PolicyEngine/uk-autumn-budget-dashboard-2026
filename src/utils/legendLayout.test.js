import { describe, expect, it } from "vitest";
import { legendLayout, subColumns, wrapLabel } from "./legendLayout";

// 7px a character, so widths are easy to reason about
const measure = (text) => String(text).length * 7;
const ICON = 16;
const RAISE = ["Threshold freeze into 2031-32", "BADR lifetime limit cut", "Salary sacrifice cap"];
const COST = [
  "Fuel duty rises deferred",
  "State Pension income tax protection",
  "Warm Home Discount top-up",
  "Zero VAT on domestic electricity",
  "Employer NI relief for under-25s",
  "Road fuel VAT cut",
];
const groups = [
  { heading: "Raise revenue", labels: RAISE },
  { heading: "Cost revenue", labels: COST },
];
const layoutAt = (available) => legendLayout({ groups, available, measure, iconWidth: ICON });

describe("legendLayout", () => {
  it("keeps each group under its own heading, a long group in two sub-columns", () => {
    const layout = layoutAt(1100);
    expect(layout.mode).toBe("split");
    expect(layout.groups.map((group) => group.columns)).toEqual([1, 2]);
    // Raise is one column of three, cost two of three: three rows
    expect(layout.lines).toBe(3);
    expect(layout.width).toBeLessThanOrEqual(1100);
  });

  it("wraps labels before giving up the sub-columns, and never overflows", () => {
    const layout = layoutAt(640);
    expect(layout.width).toBeLessThanOrEqual(640);
    expect(["split", "columns"]).toContain(layout.mode);
    // Never taller than one column each
    expect(layout.lines).toBeLessThanOrEqual(6 + 2);
  });

  it("is one column on a phone", () => {
    const layout = layoutAt(340);
    expect(layout.mode).toBe("stacked");
    expect(layout.groups.map((group) => group.columns)).toEqual([1, 1]);
    expect(layout.width).toBeLessThanOrEqual(340);
  });

  it("does not split a group of three or fewer", () => {
    const layout = legendLayout({
      groups: [{ heading: "Raise revenue", labels: RAISE }],
      available: 1100,
      measure,
      iconWidth: ICON,
    });
    expect(layout.mode).toBe("columns");
    expect(layout.groups[0].columns).toBe(1);
  });
});

describe("subColumns", () => {
  it("fills down then across", () => {
    expect(subColumns([1, 2, 3, 4, 5, 6], 2)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(subColumns([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });
});

describe("wrapLabel", () => {
  it("wraps at words to the width", () => {
    // "State Pension income" is exactly 140
    expect(wrapLabel("State Pension income tax protection", 140, measure)).toEqual([
      "State Pension income",
      "tax protection",
    ]);
    expect(wrapLabel("Short", 140, measure)).toEqual(["Short"]);
  });
});

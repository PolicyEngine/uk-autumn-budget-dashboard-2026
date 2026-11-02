import { describe, expect, it } from "vitest";
import { indexRows, lookupRow } from "./rows";
import { classifyRow } from "./classify";
import { addDecimals, stackDirection, stackReform, stackRow, withStack } from "./stack";
import { choiceLabel, choiceMeasureNames } from "./selection";

const row = (reform, value, lo, hi, tier = "reported", { areaCode = "E14000001", year = 2027, outcome = "average_change" } = {}) => ({
  level: "constituency",
  areaCode,
  areaName: "Somewhere",
  reform,
  year,
  outcome,
  value: tier === "withheld" ? "" : value,
  lo: tier === "withheld" ? "" : lo,
  hi: tier === "withheld" ? "" : hi,
  direction: "",
  tier,
  cells: {},
});
const where = { reform: "stack:a+b", areaCode: "E14000001", year: 2027, outcome: "average_change" };

describe("addDecimals", () => {
  it("adds published strings exactly, with no floating-point digits", () => {
    expect(addDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(addDecimals(["0.0012", "-0.0002"])).toBe("0.001");
    expect(addDecimals(["120.0", "-20", "1e-3"])).toBe("100.001");
    expect(addDecimals(["-5.5", "2.25"])).toBe("-3.25");
    expect(addDecimals(["3", "-3.0"])).toBe("0");
  });
});

describe("stackDirection", () => {
  it("is a gain or a loss only when the whole summed interval is one side of zero", () => {
    expect(stackDirection({ value: "5", lo: "1", hi: "9" })).toBe("gain");
    expect(stackDirection({ value: "-5", lo: "-9", hi: "-1" })).toBe("loss");
    expect(stackDirection({ value: "0", lo: "0", hi: "0" })).toBe("no_change");
    // Touching zero is too close to call for a stack
    expect(stackDirection({ value: "5", lo: "0", hi: "9" })).toBe("too_close_to_call");
    expect(stackDirection({ value: "1", lo: "-2", hi: "4" })).toBe("too_close_to_call");
  });
});

describe("stackRow", () => {
  it("sums value, lo and hi, and takes its direction from the summed interval", () => {
    // Each policy alone is a clear gain or loss; together the interval crosses zero
    const stacked = stackRow(
      [
        { name: "A", row: row("a", "30", "20", "40") },
        { name: "B", row: row("b", "-25", "-35", "-15") },
      ],
      where,
    );
    expect(stacked).toMatchObject({ value: "5", lo: "-15", hi: "25", direction: "too_close_to_call", tier: "reported" });
    expect(stacked.cells).toMatchObject({ value: "5", lo: "-15", hi: "25", reform: "stack:a+b", estimator: "sum_of_policies" });
    expect(stacked.note).toBeNull();
  });

  it("counts a withheld policy as zero and marks the seat approximate, naming it", () => {
    const stacked = stackRow(
      [
        { name: "A", row: row("a", "30", "20", "40") },
        { name: "B", row: row("b", "", "", "", "withheld") },
      ],
      where,
    );
    expect(stacked).toMatchObject({ value: "30", lo: "20", hi: "40", direction: "gain", tier: "approximate" });
    expect(stacked.note).toBe("Approximate: B not published here, counted as zero");
  });

  it("is approximate when a policy's own figure is", () => {
    const stacked = stackRow(
      [
        { name: "A", row: row("a", "30", "20", "40") },
        { name: "B", row: row("b", "-1", "-2", "0", "approximate") },
      ],
      where,
    );
    expect(stacked).toMatchObject({ value: "29", tier: "approximate", withheldPolicies: [] });
  });

  it("has no figure when every policy is withheld, and no row when none has one", () => {
    const withheld = stackRow(
      [
        { name: "A", row: row("a", "", "", "", "withheld") },
        { name: "B", row: null },
      ],
      where,
    );
    expect(withheld).toMatchObject({ tier: "withheld", value: "" });
    expect(classifyRow(withheld)).toBeNull();
    expect(stackRow([{ name: "A", row: null }, { name: "B", row: null }], where)).toBeNull();
  });
});

describe("withStack", () => {
  const table = indexRows("constituency", [
    row("a", "30", "20", "40"),
    row("b", "-10", "-12", "-8"),
    row("a", "1", "0", "2", "reported", { areaCode: "E14000002" }),
    row("b", "", "", "", "withheld", { areaCode: "E14000002" }),
  ]);
  const members = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ];

  it("adds one stacked row per seat, year and outcome, under the stack's reform", () => {
    const stacked = withStack(table, members);
    const reform = stackReform(["a", "b"]);
    expect(stacked.reforms).toContain(reform);
    expect(lookupRow(stacked, { areaCode: "E14000001", reform, year: 2027, outcome: "average_change" })).toMatchObject({
      value: "20",
      lo: "8",
      hi: "32",
      direction: "gain",
      tier: "reported",
    });
    expect(lookupRow(stacked, { areaCode: "E14000002", reform, year: 2027, outcome: "average_change" })).toMatchObject({
      value: "1",
      tier: "approximate",
      direction: "too_close_to_call",
    });
    // The published rows are kept as they are
    expect(lookupRow(stacked, { areaCode: "E14000001", reform: "a", year: 2027, outcome: "average_change" }).value).toBe("30");
  });

  it("counts a policy with no rows at all as zero, so every seat is approximate", () => {
    const stacked = withStack(table, [...members, { id: "c", name: "C" }]);
    const reform = stackReform(["a", "b", "c"]);
    const seat = lookupRow(stacked, { areaCode: "E14000001", reform, year: 2027, outcome: "average_change" });
    expect(seat).toMatchObject({ value: "20", tier: "approximate" });
    expect(seat.note).toBe("Approximate: C not published here, counted as zero");
  });

  it("leaves a single policy's table alone", () => {
    expect(withStack(table, [members[0]])).toBe(table);
  });

  it("is labelled as each policy's effect added up", () => {
    const choice = { kind: "stack", reform: "stack:a+b", members: ["a", "b"], all: false };
    expect(choiceLabel(choice, members)).toBe("Selected policies (the sum of each policy's effect)");
    expect(choiceMeasureNames(choice, members)).toEqual(["A", "B"]);
  });
});

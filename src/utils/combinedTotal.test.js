import { describe, it, expect } from "vitest";
import {
  combinedMembers,
  combinedValue,
  isCombinedCurrent,
  liveMeasureIds,
  totalSource,
} from "./combinedTotal";

const C = "autumn_budget_2026_combined";
const row = (reform_id, year, value, reform_members = "") => ({
  reform_id,
  year: String(year),
  value: String(value),
  reform_members,
});

const current = [
  row(C, 2029, -1.4, "alpha+beta"),
  row("alpha", 2029, -1),
  row("beta", 2029, -0.5),
];

describe("combined total (#105)", () => {
  it("lists the live measures without the combined run", () => {
    expect(liveMeasureIds(current)).toEqual(["alpha", "beta"]);
  });

  it("uses the combined run when it covers exactly the live measures", () => {
    expect(combinedMembers(current)).toEqual(["alpha", "beta"]);
    expect(isCombinedCurrent(current)).toBe(true);
    expect(totalSource(current, ["alpha", "beta"])).toBe("combined");
    expect(combinedValue(current, 2029)).toBe(-1.4);
  });

  it("is stale once a new measure is published", () => {
    const rows = [...current, row("gamma", 2029, 2)];
    expect(isCombinedCurrent(rows)).toBe(false);
    expect(totalSource(rows, ["alpha", "beta", "gamma"])).toBe("sum-stale");
  });

  it("is stale when publish-measure blanked its members", () => {
    const rows = [row(C, 2029, -1.4, ""), row("alpha", 2029, -1), row("beta", 2029, -0.5)];
    expect(totalSource(rows, ["alpha", "beta"])).toBe("sum-stale");
  });

  it("keeps today's unlabelled sum for a file without the members column", () => {
    const rows = current.map(({ reform_members: _unused, ...rest }) => rest);
    expect(combinedMembers(rows)).toBeNull();
    expect(totalSource(rows, ["alpha", "beta"])).toBe("sum");
  });

  it("keeps a partial selection's sum unlabelled, as before", () => {
    const rows = [...current, row("gamma", 2029, 2)];
    expect(totalSource(rows, ["alpha", "gamma"])).toBe("sum");
    expect(totalSource(rows, ["alpha"])).toBe("single");
    expect(totalSource(rows, [])).toBe("none");
  });

  it("has no combined value for a year it does not cover", () => {
    expect(combinedValue(current, 2030)).toBeNull();
  });
});

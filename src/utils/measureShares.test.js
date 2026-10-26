import { describe, expect, it } from "vitest";
import { filterShareRows, sharesByMeasure } from "./measureShares";

const share = (id, better, worse) => ({ id, name: id, row: { pct_better_off: better, pct_unchanged: 100 - better - worse, pct_worse_off: worse } });

describe("filterShareRows", () => {
  const rows = [share("a", 2, 0), share("b", 0, 0), share("c", 10, 5), share("d", 0, 3)];

  it("hides measures with no effect and puts the largest effect first", () => {
    const { rows: out, hidden } = filterShareRows(rows);
    expect(out.map((r) => r.id)).toEqual(["c", "d", "a"]);
    expect(hidden).toBe(1);
  });

  it("keeps every measure in catalogue order when asked", () => {
    const { rows: out, hidden } = filterShareRows(rows, { hide: "show", order: "catalogue" });
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(hidden).toBe(0);
  });

  it("shows only gains or only losses", () => {
    expect(filterShareRows(rows, { direction: "gains" }).rows.map((r) => r.id)).toEqual(["c", "a"]);
    expect(filterShareRows(rows, { direction: "losses" }).rows.map((r) => r.id)).toEqual(["c", "d"]);
  });
});

describe("sharesByMeasure", () => {
  const policies = [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "z", name: "Z" }];
  const sharesFn = (rows, all, [id]) => ({
    groups: [
      { key: "pensioners", label: "Pensioners", row: { pct_better_off: id === "x" ? 4 : 0, pct_worse_off: 0 } },
      { key: "all", label: "All ages", row: null, suppressed: true },
    ],
  });

  it("gives one row per selected measure for the chosen group, never a sum", () => {
    const view = sharesByMeasure(sharesFn, [], policies, ["x", "y"], 2027, "combined", "pensioners");
    expect(view.rows.map((r) => r.id)).toEqual(["x", "y"]);
    expect(view.groups.map((g) => g.key)).toEqual(["pensioners", "all"]);
    // A group too thin for a measure lists it as missing
    expect(sharesByMeasure(sharesFn, [], policies, ["x", "y"], 2027, "combined", "all").missing).toEqual(["X", "Y"]);
  });

  it("is null when the selection has its own run", () => {
    expect(sharesByMeasure(sharesFn, [], policies, ["x"], 2027, "combined", "pensioners")).toBeNull();
    expect(sharesByMeasure(sharesFn, [], policies, ["x", "y", "z"], 2027, "combined", "pensioners")).toBeNull();
  });
});

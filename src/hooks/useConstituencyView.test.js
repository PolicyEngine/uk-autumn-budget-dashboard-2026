import { describe, expect, it } from "vitest";
import { constituencyResultReforms } from "./useConstituencyView";

const table = (rows) => {
  const byReform = new Map();
  for (const row of rows) byReform.set(row.reform, [...(byReform.get(row.reform) ?? []), row]);
  return { byReform };
};

describe("constituencyResultReforms", () => {
  it("offers a reform only when some seat reports a non-zero change", () => {
    const rows = [
      // Every published figure zero, the rest withheld: a blank map
      { reform: "badr_lifetime_limit_cut", tier: "reported", value: "0.0" },
      { reform: "badr_lifetime_limit_cut", tier: "withheld", value: "" },
      { reform: "threshold_freeze_2031_32", tier: "reported", value: "0.0" },
      { reform: "threshold_freeze_2031_32", tier: "approximate", value: "-77.0" },
    ];
    expect(constituencyResultReforms(table(rows))).toEqual(["threshold_freeze_2031_32"]);
  });

  it("offers nothing before the table loads", () => {
    expect(constituencyResultReforms(null)).toEqual([]);
  });
});

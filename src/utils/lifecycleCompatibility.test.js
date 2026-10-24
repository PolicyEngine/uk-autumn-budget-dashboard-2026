import { describe, expect, it } from "vitest";
import household from "../test/fixtures/lifecycle/default-household.json";
import metadata from "../test/fixtures/lifecycle/legacy-published-measures.json";
import { lifecycleSelection, lifecycleTotals } from "./lifecycleSelection";

// This historical API fixture deliberately retains its old key-only mappings.
// Column compatibility cannot attest to the published policy parameters.
const measures = metadata.map((item) => ({
  ...item, label: item.name, displayable: true,
  years: household.data.map((row) => row.year), unsupported_years: [],
}));

describe("legacy lifetime calculation compatibility", () => {
  it("treats all nine legacy mappings as not modelled even with finite API results", () => {
    expect(measures).toHaveLength(9);
    const selection = lifecycleSelection(measures.map((item) => item.id), measures, household.data);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toHaveLength(9);
    expect(lifecycleTotals(household.data, selection.reforms).netTotal).toBeNull();
  });
});

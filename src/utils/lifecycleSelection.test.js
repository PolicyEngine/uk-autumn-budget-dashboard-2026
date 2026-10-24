import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { lifecycleSelection, lifecycleTotals } from "./lifecycleSelection";

const alpha = { id: "ab2026_mock_alpha", label: "Mock alpha", description: "Alpha public description.", displayable: true, color: "#0D9488" };
const beta = { id: "ab2026_mock_beta", label: "Mock beta", description: "Beta public description.", displayable: true, color: "#78350F" };
const rows = [
  { impact_ab2026_mock_alpha: 10, ab2026_mock_beta: -200 },
  { impact_ab2026_mock_alpha: 12, ab2026_mock_beta: -250 },
];
const keys = (selection) => selection.reforms.map((reform) => reform.key);

describe("lifetime series for published measures", () => {
  it("matches unfamiliar ids to response keys and keeps catalogue colours", () => {
    const selection = lifecycleSelection([alpha.id, beta.id], [alpha, beta], rows);
    expect(keys(selection)).toEqual(["impact_ab2026_mock_alpha", "ab2026_mock_beta"]);
    expect(selection.reforms.map((reform) => reform.color)).toEqual([alpha.color, beta.color]);
    expect(lifecycleSelection([beta.id, alpha.id], [alpha, beta], rows).reforms)
      .toEqual(selection.reforms);
    expect(selection.unmodelled).toEqual([]);
    expect(lifecycleTotals(rows, selection.reforms)).toEqual({ netTotal: -428, avgPerYear: -214 });
  });

  it("requires every member of a published shared series", () => {
    const measures = [alpha, beta].map((measure) => ({
      ...measure, personal: { key: "shared_impact", policies: [alpha.id, beta.id] },
    }));
    const data = [{ shared_impact: 30 }];
    const partial = lifecycleSelection([alpha.id], measures, data);
    expect(keys(partial)).toEqual([]);
    expect(partial.partialCombined).toBe(true);
    expect(partial.unmodelled).toEqual([alpha.label]);
    const full = lifecycleSelection([alpha.id, beta.id], measures, data);
    expect(keys(full)).toEqual(["shared_impact"]);
    expect(full.reforms[0].description).toBe(`${alpha.description} ${beta.description}`);
    expect(lifecycleTotals(data, full.reforms).netTotal).toBe(30);
    const heldMember = lifecycleSelection([alpha.id, beta.id], [measures[0], { ...measures[1], displayable: false }], data);
    expect(keys(heldMember)).toEqual([]);
    expect(heldMember.unmodelled).toEqual([alpha.label, beta.label]);
  });

  it("names unsupported, held and incomplete measures instead of inserting zero", () => {
    const held = { ...beta, displayable: false };
    expect(lifecycleSelection([alpha.id, beta.id], [alpha, held], rows).unmodelled).toEqual([beta.label]);
    expect(lifecycleSelection([alpha.id], [alpha], [{}, ...rows]).unmodelled).toEqual([alpha.label]);
    expect(lifecycleSelection([alpha.id], [{ ...alpha, personal: { key: "missing_published_series" } }], rows).unmodelled)
      .toEqual([alpha.label]);
    const unknown = lifecycleSelection(["unknown"], [], rows);
    expect(unknown.unmodelled).toEqual(["unknown"]);
    expect(unknown.partialCombined).toBe(false);
    expect(lifecycleTotals([{}], [{ key: "missing" }])).toEqual({ netTotal: null, avgPerYear: null });
    expect(lifecycleTotals(rows, [])).toEqual({ netTotal: null, avgPerYear: null });
  });

  it("never totals unrelated API columns for an arbitrary published id", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), (id) => {
      const measure = { id, label: `Measure ${id}`, displayable: true };
      const data = [{ unrelated_api_column: 100 }];
      const selection = lifecycleSelection([id], [measure], data);
      if (id === "unrelated_api_column") expect(keys(selection)).toEqual([id]);
      else expect(selection.unmodelled).toEqual([measure.label]);
    }));
  });
});

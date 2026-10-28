import { describe, expect, it } from "vitest";
import { ALPHA, BETA, COMBINED, HELD, measureCatalogueFixture } from "../../test/measureCatalogueFixture";
import {
  SELECTION_NOT_PUBLISHED,
  chooseSelectionReform,
  selectionNotPublished,
  selectionPackageKey,
  choiceLabel,
  choiceMeasureNames,
} from "./selection";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const policyIds = POLICIES.map((policy) => policy.id);
describe("labels", () => {
  it("names the measure, or the package and its measures", () => {
    const measure = { kind: "measure", reform: "fuel_duty_freeze" };
    const pkg = { kind: "package", reform: "autumn_budget_2026_combined" };
    expect(choiceLabel(measure, POLICIES)).toBe("Fuel duty freeze extension");
    expect(choiceLabel(pkg, POLICIES)).toBe("All policies (the full package)");
    expect(choiceMeasureNames(pkg, POLICIES)).toEqual(
      POLICIES.map((policy) => policy.name),
    );
    expect(choiceMeasureNames({ kind: "no-package" }, POLICIES)).toEqual([]);
  });
});

describe("chooseSelectionReform", () => {
  const SEVEN = ["a", "b", "c", "d", "e", "f", "g"];
  const KEY = "combined--5c77771791661e11";

  it("takes the combined run of exactly the selection for several policies", () => {
    expect(chooseSelectionReform({ selectedIds: SEVEN, policyIds: SEVEN, reforms: ["a", KEY], packageKey: KEY }))
      .toEqual({ kind: "package", reform: KEY, members: SEVEN, all: true });
    expect(chooseSelectionReform({ selectedIds: ["c", "a"], policyIds: SEVEN, reforms: [KEY], packageKey: KEY }))
      .toMatchObject({ kind: "package", reform: KEY, members: ["a", "c"], all: false });
  });

  it("takes one policy's own run when one is selected", () => {
    expect(chooseSelectionReform({ selectedIds: ["b"], policyIds: SEVEN, reforms: ["b"], packageKey: KEY }))
      .toEqual({ kind: "measure", reform: "b" });
  });

  it("says the combination is not published, never taking a policy in its place", () => {
    for (const packageKey of [KEY, null]) {
      const choice = chooseSelectionReform({ selectedIds: SEVEN, policyIds: SEVEN, reforms: SEVEN, packageKey });
      expect(choice).toEqual({ kind: "no-package", reason: SELECTION_NOT_PUBLISHED, members: SEVEN, all: true });
      expect(choice.reform).toBeUndefined();
    }
    // A card names its own results in the same sentence
    expect(
      chooseSelectionReform({ selectedIds: ["a", "b"], policyIds: SEVEN, reforms: ["a", "b"], reason: selectionNotPublished("Regional") }).reason,
    ).toBe("Regional results for this combination of policies are not published yet.");
  });

  it("is empty with nothing selected", () => {
    expect(chooseSelectionReform({ selectedIds: [], policyIds: SEVEN, reforms: SEVEN })).toEqual({ kind: "none" });
  });
});

describe("selectionPackageKey", () => {
  it("is the combined run of exactly the selection, or null", () => {
    const { manifest } = measureCatalogueFixture({ held: false });
    expect(selectionPackageKey(manifest, [BETA, ALPHA])).toBe(COMBINED);
    // One policy (duplicates are one), or no manifest: no combined run is wanted
    expect(selectionPackageKey(manifest, [ALPHA, ALPHA])).toBeNull();
    expect(selectionPackageKey(null, [ALPHA, BETA])).toBeNull();
    // No combined run of exactly this set is published
    const three = measureCatalogueFixture({ held: true }).manifest;
    three.measures[HELD].status = "approved";
    expect(selectionPackageKey(three, [ALPHA, BETA])).toBeNull();
  });
});


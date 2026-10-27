import { describe, expect, it } from "vitest";
import {
  SELECTION_NOT_PUBLISHED,
  chooseSelectionReform,
  selectionFocus,
  chooseReform,
  choiceLabel,
  choiceMeasureNames,
} from "./selection";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const policyIds = POLICIES.map((policy) => policy.id);
const reforms = [
  "autumn_budget_2026_combined",
  "fuel_duty_freeze",
  "two_child_limit",
];
// The catalogue's package: the combined run of the displayable measures
const packageId = "autumn_budget_2026_combined";

describe("chooseReform", () => {
  it("shows one selected measure's own reform", () => {
    expect(
      chooseReform({ selectedIds: ["fuel_duty_freeze"], policyIds, reforms }),
    ).toEqual({ kind: "measure", reform: "fuel_duty_freeze" });
  });

  it("shows the package when every measure is selected, in any order", () => {
    const choice = chooseReform({
      selectedIds: [...policyIds].reverse(),
      policyIds,
      reforms,
      packageId,
    });
    expect(choice).toEqual({
      kind: "package",
      reform: "autumn_budget_2026_combined",
    });
  });

  it("never sums: several measures but not all is a request to pick", () => {
    expect(
      chooseReform({
        selectedIds: ["fuel_duty_freeze", "two_child_limit"],
        policyIds,
        reforms,
      }),
    ).toEqual({ kind: "pick" });
    // Duplicates do not make a selection whole.
    expect(
      chooseReform({
        selectedIds: ["fuel_duty_freeze", "fuel_duty_freeze", "two_child_limit"],
        policyIds,
        reforms,
      }),
    ).toEqual({ kind: "pick" });
  });

  it("finds no package unless the catalogue names one the data carries", () => {
    expect(
      chooseReform({ selectedIds: policyIds, policyIds, reforms: ["fuel_duty_freeze"], packageId }),
    ).toEqual({ kind: "no-package" });
    // A "_combined" reform is never taken for the package by its name
    for (const missing of [null, undefined]) {
      expect(
        chooseReform({ selectedIds: policyIds, policyIds, reforms, packageId: missing }),
      ).toEqual({ kind: "no-package" });
    }
    expect(
      chooseReform({ selectedIds: policyIds, policyIds, reforms, packageId: "combined--other" }),
    ).toEqual({ kind: "no-package" });
  });

  it("is empty with nothing selected", () => {
    expect(chooseReform({ selectedIds: [], policyIds, reforms })).toEqual({
      kind: "none",
    });
  });
});

describe("labels", () => {
  it("names the measure, or the package and its measures", () => {
    const measure = { kind: "measure", reform: "fuel_duty_freeze" };
    const pkg = { kind: "package", reform: "autumn_budget_2026_combined" };
    expect(choiceLabel(measure, POLICIES)).toBe("Fuel duty freeze extension");
    expect(choiceLabel(pkg, POLICIES)).toBe("All policies (the full package)");
    expect(choiceMeasureNames(pkg, POLICIES)).toEqual(
      POLICIES.map((policy) => policy.name),
    );
    expect(choiceMeasureNames({ kind: "pick" }, POLICIES)).toEqual([]);
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
      // The per-policy option defaults to the combination
      const focused = selectionFocus(choice, { reforms: SEVEN });
      expect(focused.kind).toBe("no-package");
      expect(focused.focus.options).toEqual(SEVEN);
    }
  });

  it("shows one policy only when the reader picks a selected one", () => {
    const choice = chooseSelectionReform({ selectedIds: ["a", "b"], policyIds: SEVEN, reforms: [KEY, "a"], packageKey: KEY });
    expect(selectionFocus(choice, { reforms: ["a"], focusId: "a" })).toMatchObject({ kind: "measure", reform: "a" });
    expect(selectionFocus(choice, { reforms: ["a"], focusId: "g" })).toMatchObject({ kind: "package", reform: KEY });
  });
});

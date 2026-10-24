import { describe, expect, it } from "vitest";
import {
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
    expect(choiceLabel(pkg, POLICIES)).toBe("All measures (the full package)");
    expect(choiceMeasureNames(pkg, POLICIES)).toEqual(
      POLICIES.map((policy) => policy.name),
    );
    expect(choiceMeasureNames({ kind: "pick" }, POLICIES)).toEqual([]);
  });
});

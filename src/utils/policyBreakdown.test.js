import { describe, expect, it } from "vitest";
import { attributedRows, parameterChange, parameterRowsFor, policyTabs } from "./policyBreakdown";
import { groupTotals, policyRows, programmeGroups, roundProgrammeGroups } from "./singleYear";

// An answer shaped as the household API's (2027-28, Plan 2, petrol and
// electricity spending entered), after normaliseHouseholdImpact
const PLAN_2_DESCRIPTION = "Plan 2 threshold unfrozen (test)";
const FUEL_DESCRIPTION = "Fuel duty deferred (test)";
const policies = [
  { id: "plan_2_threshold_unfreeze", name: "Plan 2 student loan threshold unfrozen", description: PLAN_2_DESCRIPTION, color: "var(--x)" },
  { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", description: FUEL_DESCRIPTION, color: "var(--y)" },
  { id: "threshold_freeze_2031_32", name: "Threshold freeze to 2031-32", description: "Freeze (test)", color: "var(--z)" },
  { id: "budget_day_measure", name: "A Budget-day measure", description: "New (test)", color: "var(--w)" },
];
const parameters = {
  schema: "uk-budget-dashboard/policy-parameters/v1",
  measures: {
    plan_2_threshold_unfreeze: {
      description: PLAN_2_DESCRIPTION,
      display: "path",
      rows: [
        {
          label: "Plan 2 repayment threshold",
          unit: "gbp",
          primary: true,
          points: [
            { key: "2026", year: 2026, before: 29385, after: 29385 },
            { key: "2027", year: 2027, before: 29385, after: 30267 },
          ],
        },
      ],
    },
    fuel_duty_rise_deferral: {
      description: FUEL_DESCRIPTION,
      display: "schedule",
      rows: [
        { label: "Fuel duty", unit: "pence_per_litre", primary: true, points: [{ key: "2027-01-01", before: 55.95, after: 52.95 }] },
        {
          label: "Fuel duty, averaged over the year",
          unit: "pence_per_litre",
          primary: false,
          points: [{ key: "2027", year: 2027, before: 59.774454, after: 55.4546 }],
        },
      ],
    },
    // Built from another description: never shown
    threshold_freeze_2031_32: {
      description: "Something else",
      display: "table",
      rows: [{ label: "Personal allowance", unit: "gbp", primary: true, points: [{ key: "2027", before: 1, after: 2 }] }],
    },
  },
};
const programmes = [
  { id: "income_tax", label: "Income Tax", before: 5678.01, after: 5678.01, change: 0, group: "tax" },
  { id: "student_loan_repayments", label: "Student loan repayments", before: 1041.75, after: 962.37, change: -79.38, group: "tax" },
  { id: "fuel_duty", label: "Fuel duty", before: 475.61, after: 441.24, change: -34.37, group: "tax" },
  { id: "vat_change", label: "VAT", before: 0, after: -53.3, change: -53.3, group: "tax" },
  { id: "employment_income", label: "Employment income", before: 40960.04, after: 40960.04, change: 0, group: "income" },
];
const byPolicy = {
  measures: [
    { id: "domestic_electricity_zero_vat", name: "Zero VAT on domestic electricity", change: 38.1, status: "affected" },
    { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", change: 41.25, status: "affected" },
    { id: "plan_2_threshold_unfreeze", name: "Plan 2 student loan threshold unfrozen", change: 79.38, status: "affected" },
    { id: "road_fuel_vat_cut", name: "VAT cut on road fuel", change: 8.33, status: "affected" },
    { id: "threshold_freeze_2031_32", name: "Threshold freeze to 2031-32", change: 0, status: "not_affected" },
  ],
  residual: 0,
};
const household = { petrol_spending: 1200, diesel_spending: 0, electricity_spending: 800, student_loan_plan: "PLAN_2" };
const totals = { before: 29363.58, after: 29530.63, change: 167.05 };

const build = (overrides = {}) => {
  const bars = policyRows(overrides.byPolicy ?? byPolicy, (overrides.totals ?? totals).change, policies);
  const groups = groupTotals(roundProgrammeGroups(programmeGroups(overrides.programmes ?? programmes), overrides.totals ?? totals, bars.all));
  const result = policyTabs({
    bars,
    groups,
    policies,
    parameters,
    year: 2027,
    household: overrides.household ?? household,
    salaryUsed: overrides.salaryUsed ?? 40960.04,
  });
  return { bars, groups, ...result };
};

describe("policyTabs", () => {
  it("gives each affected policy a tab and folds the rest into no effect", () => {
    const { tabs, noEffect } = build();
    expect(tabs.map((tab) => tab.id)).toEqual([
      "domestic_electricity_zero_vat",
      "fuel_duty_rise_deferral",
      "plan_2_threshold_unfreeze",
      "road_fuel_vat_cut",
    ]);
    expect(noEffect.map((item) => item.id)).toEqual(["threshold_freeze_2031_32"]);
  });

  it("reconciles each tab's effect with the split by policy, and their sum with the Summary's change", () => {
    const { tabs, bars } = build();
    for (const tab of tabs) {
      expect(tab.effect).toBe(bars.all.find((bar) => bar.id === tab.id).rounded);
    }
    const interaction = bars.all.find((bar) => bar.id === "interaction")?.rounded ?? 0;
    expect(tabs.reduce((sum, tab) => sum + tab.effect, 0) + interaction).toBe(Math.round(totals.change));
  });

  it("keeps the interaction row's pounds out of the tabs but in the sum", () => {
    const withResidual = { ...byPolicy, residual: 3.2 };
    const changed = { ...totals, change: totals.change + 3.2 };
    const { tabs, bars } = build({ byPolicy: withResidual, totals: changed });
    expect(tabs.some((tab) => tab.id === "interaction")).toBe(false);
    const interaction = bars.all.find((bar) => bar.id === "interaction").rounded;
    expect(tabs.reduce((sum, tab) => sum + tab.effect, 0) + interaction).toBe(Math.round(changed.change));
  });

  it("shows the student loan steps when 9% of income above the threshold is the API's repayment", () => {
    const tab = build().tabs.find((item) => item.id === "plan_2_threshold_unfreeze");
    expect(tab.parameters).toEqual([
      { kind: "parameter", id: "Plan 2 repayment threshold", label: "Plan 2 repayment threshold", unit: "gbp", before: 29385, after: 30267 },
    ]);
    expect(tab.household.map((row) => row.id)).toEqual(["employment_income", "income_above_threshold", "student_loan_repayments"]);
    const repayment = tab.household.find((row) => row.id === "student_loan_repayments");
    expect(repayment.label).toBe("Repayment (9% of income above the threshold)");
    // The Summary's row, and the tab's effect, to the pound
    expect(repayment.change).toBe(tab.effect);
  });

  it("drops the student loan steps when they would not match the API's repayment", () => {
    // Other income counts towards repayments: 9% of salary alone is then wrong
    const tab = build({ salaryUsed: 38000 }).tabs.find((item) => item.id === "plan_2_threshold_unfreeze");
    expect(tab.household.map((row) => row.id)).not.toContain("income_above_threshold");
    // The row the measure alone moves still shows, as in the Summary
    expect(tab.household.map((row) => row.id)).toEqual(["student_loan_repayments"]);
    const other = build({ household: { ...household, student_loan_plan: "PLAN_1" } }).tabs.find(
      (item) => item.id === "plan_2_threshold_unfreeze",
    );
    expect(other.household.map((row) => row.id)).not.toContain("income_above_threshold");
  });

  it("uses the year's averaged rate and the spending entered for a fuel measure", () => {
    const tab = build().tabs.find((item) => item.id === "fuel_duty_rise_deferral");
    expect(tab.parameters.map((row) => row.label)).toEqual(["Fuel duty, averaged over the year"]);
    expect(tab.household[0]).toMatchObject({ kind: "input", before: 1200, after: 1200 });
    // Fuel duty's row moves with the road fuel VAT cut too: not this measure's alone
    expect(tab.household.map((row) => row.id)).toEqual(["fuel_spending"]);
  });

  it("gives a measure without matching parameters only its effect", () => {
    const { tabs } = build({
      byPolicy: {
        measures: [{ id: "budget_day_measure", name: "A Budget-day measure", change: 12, status: "affected" }],
        residual: 0,
      },
      totals: { before: 100, after: 112, change: 12 },
      programmes: [{ id: "income_tax", label: "Income Tax", before: 50, after: 38, change: -12, group: "tax" }],
    });
    expect(tabs).toHaveLength(1);
    expect(tabs[0].parameters).toEqual([]);
    expect(tabs[0].effect).toBe(12);
    // The only measure: every row it moves is its own
    expect(tabs[0].household.map((row) => row.id)).toEqual(["income_tax"]);
  });

  it("is empty before the split by policy is in", () => {
    expect(policyTabs({ bars: null, groups: [], policies, parameters, year: 2027 })).toEqual({ tabs: [], noEffect: [] });
  });
});

describe("parameterRowsFor and parameterChange", () => {
  it("ignores a file entry built from another description", () => {
    expect(parameterRowsFor(parameters, policies[2], 2027)).toEqual([]);
  });

  it("words changes in their unit, a rate as lower or higher", () => {
    expect(parameterChange({ unit: "gbp", before: 29385, after: 30267 })).toBe("+£882");
    expect(parameterChange({ unit: "pence_per_litre", before: 59.774454, after: 55.4546 })).toBe("−4.32p");
    expect(parameterChange({ unit: "percent", before: 0.05, after: 0 })).toBe("Lower");
    expect(parameterChange({ unit: "gbp", before: 12570, after: 12570 })).toBeNull();
  });
});

describe("attributedRows", () => {
  it("never gives a row to a measure when another measure has the same change", () => {
    const bars = { all: [{ id: "a", change: 10 }, { id: "b", change: 10 }] };
    const groups = [{ rows: [{ id: "x", change: 10, shown: { change: 10 } }] }];
    expect(attributedRows(groups, bars, "a")).toEqual([]);
  });
});

describe("a measure without parameters", () => {
  it("still shows the spending it works on, from its name, but never for the Winter Fuel Payment", () => {
    const bars = {
      all: [
        { id: "road_fuel_vat_cut", name: "VAT cut on road fuel", change: 8, rounded: 8 },
        { id: "wfp", name: "Winter Fuel Payment raised", change: 5, rounded: 5 },
      ],
      noEffectItems: [],
    };
    const { tabs } = policyTabs({
      bars,
      groups: [],
      policies: [
        { id: "road_fuel_vat_cut", name: "VAT cut on road fuel", description: "x" },
        { id: "wfp", name: "Winter Fuel Payment raised", description: "y" },
      ],
      parameters: null,
      year: 2027,
      household: { petrol_spending: 1200 },
    });
    expect(tabs[0].household.map((row) => row.id)).toEqual(["fuel_spending"]);
    expect(tabs[1].household).toEqual([]);
  });
});

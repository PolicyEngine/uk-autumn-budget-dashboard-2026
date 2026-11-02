import { describe, expect, it } from "vitest";
import { parameterChange, parameterRowsFor, policyTabs } from "./policyBreakdown";
import { groupTotals, policyRows, programmeGroups, roundProgrammeGroups } from "./singleYear";
import live from "../test/fixtures/policyTabsAnswers.json";
import { normaliseHouseholdImpact } from "./householdImpactApi";

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

// The household API's own answers for the example households (27 October
// 2026, every measure then published selected) and the published parameters

const livePolicies = Object.entries(live.parameters.measures).map(([id, entry]) => ({
  id,
  name: id,
  description: entry.description,
}));
const liveTabs = (key) => {
  const { household: liveHousehold, answer } = live.answers[key];
  const data = normaliseHouseholdImpact(answer);
  const totals = data.net;
  const split = policyRows(data.byPolicy, totals.change, livePolicies);
  const shownGroups = groupTotals(roundProgrammeGroups(programmeGroups(data.programmes), totals, split.all));
  return {
    split,
    totals,
    ...policyTabs({
      bars: split,
      groups: shownGroups,
      policies: livePolicies,
      parameters: live.parameters,
      year: data.year,
      household: liveHousehold,
      salaryUsed: data.salaryUsed,
    }),
  };
};
const tabOf = (tabs, id) => tabs.find((tab) => tab.id === id);
const parts = (tab) => tab.household.filter((row) => row.kind === "part");
const byId = (tab) => Object.fromEntries(tab.household.map((row) => [row.id, row]));

describe("policy tabs on the household API's answers", () => {
  it("every tab's parts add up to its effect, and the effects to the Summary's change", () => {
    for (const key of Object.keys(live.answers)) {
      const { tabs, split, totals } = liveTabs(key);
      for (const tab of tabs) {
        expect(tab.effect, `${key} ${tab.id}`).toBe(split.all.find((bar) => bar.id === tab.id).rounded);
        if (parts(tab).length) {
          expect(parts(tab).reduce((sum, row) => sum + row.change, 0), `${key} ${tab.id}`).toBe(tab.effect);
        }
        for (const row of parts(tab)) {
          if (row.before !== null) expect(row.after - row.before, `${key} ${tab.id} ${row.id}`).toBe(row.change);
        }
      }
      const interaction = split.all.find((bar) => bar.id === "interaction")?.rounded ?? 0;
      expect(tabs.reduce((sum, tab) => sum + tab.effect, 0) + interaction, key).toBe(Math.round(totals.change));
    }
  });

  it("walks a part-time worker through the employer NI threshold, then the higher pay through the bands", () => {
    const tab = tabOf(liveTabs("pt-2027").tabs, "employer_nics_secondary_threshold_raise");
    const rows = byId(tab);
    expect(tab.parameters[0]).toMatchObject({ before: 5000, after: 9100 });
    expect(Math.round(rows.employer_cost.before)).toBe(Math.round(rows.employer_cost.after));
    expect(Math.round(rows.employer_ni.before)).toBe(1247);
    expect(Math.round(rows.employer_ni.after)).toBe(712);
    // The higher pay through the bands: the API's tax and NI, before and after
    expect(rows.personal_allowance_used).toMatchObject({ before: 12570, after: 12570 });
    expect(Math.round(rows["band_earned:basic"].after - rows["band_earned:basic"].before)).toBe(535);
    expect(rows["tax_earned:basic"].before).toBeCloseTo(148.4, 1);
    expect(rows["tax_earned:basic"].after).toBeCloseTo(255.36, 1);
    expect(parts(tab).map((row) => [row.id, row.change])).toEqual([
      ["employment_income", 535],
      ["income_tax_total", -107],
      ["national_insurance_total", -43],
    ]);
    expect(rows.income_tax_total).toMatchObject({ before: -148, after: -255 });
    expect(tab.effect).toBe(385);
    // The card's short summary (policyDetails.js), not the published description
    expect(tab.how).toMatch(/^Raises the employer National Insurance threshold/);
  });

  it("gives the employer NI tab its own tax on the higher pay when the freeze moves the same taxes", () => {
    // 2031-32: the API's tax after is both measures'; the bands give this one's
    const tab = tabOf(liveTabs("pt-2031").tabs, "employer_nics_secondary_threshold_raise");
    expect(parts(tab).map((row) => row.id)).toEqual(["employment_income", "income_tax_total", "national_insurance_total"]);
    // Universal Credit falls with the higher pay too
    const uc = tabOf(liveTabs("uc-2027").tabs, "employer_nics_secondary_threshold_raise");
    expect(parts(uc).map((row) => row.id)).toEqual(["employment_income", "income_tax_total", "national_insurance_total", "universal_credit"]);
    // With the freeze moving Universal Credit too, only the total taken back
    const both = tabOf(liveTabs("uc-2031").tabs, "employer_nics_secondary_threshold_raise");
    expect(parts(both).map((row) => row.id)).toEqual(["employment_income", "taken_back"]);
  });

  it("shows the landlord's income of each kind, each band and its rate before and after", () => {
    const tab = tabOf(liveTabs("land-2027").tabs, "unearned_income_rates_up");
    const rows = byId(tab);
    expect(tab.household.filter((row) => row.kind === "input").map((row) => [row.id, Math.round(row.before)])).toEqual([
      ["income_earned", 51200],
      ["income_property", 9000],
      ["income_savings", 2000],
      ["income_dividends", 3000],
    ]);
    expect(rows["band_property:higher"]).toMatchObject({ label: "Property income at the higher rate (42% → 44%)", before: 9000, after: 9000 });
    expect(rows["band_savings:allowance"]).toMatchObject({ label: "Savings interest in the personal savings allowance (0%)", before: 500 });
    expect(rows["band_dividends:allowance"]).toMatchObject({ before: 500 });
    expect(rows["tax_dividends:higher"].before).toBeCloseTo(893.75, 2);
    expect(rows["tax_dividends:higher"].after).toBeCloseTo(943.75, 2);
    expect(parts(tab).map((row) => [row.id, row.before, row.after, row.change])).toEqual([["income_tax_total", -13216, -13476, -260]]);
  });

  it("shows a pensioner's allowance rising above their total income of £12,800, and the Council Tax Reduction it costs", () => {
    const tab = tabOf(liveTabs("pens-2027").tabs, "state_pension_income_tax_protection");
    const rows = byId(tab);
    expect(rows.income_earned).toMatchObject({ before: 12800 });
    expect(rows.personal_allowance_used).toMatchObject({ before: 12570, after: 13037 });
    expect(rows["band_earned:basic"]).toMatchObject({ before: 230, after: 0 });
    expect(parts(tab).map((row) => [row.id, row.change])).toEqual([
      ["income_tax_total", 46],
      ["council_tax_reduction", -9],
    ]);
  });

  it("shows each band the freeze moves, income tax and National Insurance, adding up to its effect", () => {
    const tab = tabOf(liveTabs("land-2031").tabs, "threshold_freeze_2031_32");
    const rows = byId(tab);
    expect(rows.personal_allowance_used).toMatchObject({ before: 12830, after: 12570 });
    expect(rows.ni_upper.after - rows.ni_upper.before).toBeCloseTo(1060, 6);
    expect(parts(tab).map((row) => [row.id, row.change])).toEqual([
      ["income_tax_total", -264],
      ["national_insurance_total", 43],
    ]);
    expect(tab.effect).toBe(-221);
  });

  it("splits the fuel duty saving into duty and the VAT on it", () => {
    const tab = tabOf(liveTabs("drv-2027").tabs, "fuel_duty_rise_deferral");
    expect(byId(tab).fuel_spending).toMatchObject({ before: 2600 });
    expect(tab.parameters.map((row) => row.label)).toEqual(["Fuel duty, averaged over the year"]);
    expect(parts(tab).map((row) => [row.id, row.change])).toEqual([
      ["fuel_duty", 111],
      ["fuel_duty_vat", 22],
    ]);
    expect(byId(tab).fuel_duty).toMatchObject({ before: -971, after: -860 });
  });

  it("works out the VAT inside electricity spending, before and after", () => {
    const tab = tabOf(liveTabs("drv-2027").tabs, "domestic_electricity_zero_vat");
    expect(parts(tab)).toEqual([expect.objectContaining({ id: "electricity_vat", before: -48, after: 0, change: 48 })]);
  });

});

describe("a tax reduction (the Pension Tax Allowance's design)", () => {
  // HM Treasury's 2027-28 case: total income £13,186.40, £150 above the
  // full new State Pension, so the £94 reduction is cut by £50 to £44
  const ID = "pension_measure";
  const reductionParameters = {
    schema: "uk-budget-dashboard/policy-parameters/v1",
    measures: {
      [ID]: {
        description: "Reduction (test)",
        display: "path",
        rows: [
          {
            label: "Pension Tax Allowance, the largest tax reduction",
            unit: "gbp",
            unit_words: "£ of income tax a year",
            primary: true,
            points: [{ key: "2027", year: 2027, before: 0, after: 94 }],
            note: "For people over State Pension age; reduced by £1 for every £3 of total income above the full new State Pension",
          },
        ],
      },
    },
  };
  const tabFor = (taxBefore, taxAfter) => {
    const change = taxBefore - taxAfter;
    const bars = policyRows({ measures: [{ id: ID, name: "Pension measure", change, status: "affected" }], residual: 0 }, change, [
      { id: ID, name: "Pension measure", description: "Reduction (test)", color: "var(--x)" },
    ]);
    const programmes = [
      { id: "income_tax", label: "Income Tax", before: taxBefore, after: taxAfter, change: taxAfter - taxBefore, group: "tax" },
      { id: "state_pension", label: "State Pension", before: 13186.4, after: 13186.4, change: 0, group: "income" },
    ];
    const net = { before: 13186.4 - taxBefore, after: 13186.4 - taxAfter, change };
    const groups = groupTotals(roundProgrammeGroups(programmeGroups(programmes), net, bars.all));
    const policies = [{ id: ID, name: "Pension measure", description: "Reduction (test)", color: "var(--x)" }];
    return policyTabs({ bars, groups, policies, parameters: reductionParameters, year: 2027, household: {}, salaryUsed: 0 }).tabs[0];
  };

  it("shows income tax without it, the largest reduction, the taper and income tax with it", () => {
    const tab = tabFor(123.28, 79.28);
    const rows = Object.fromEntries(tab.household.map((row) => [row.id, row]));
    expect(rows.tax_without_reduction).toMatchObject({ kind: "input", before: 123.28 });
    expect(rows.tax_reduction_largest).toMatchObject({ label: "Pension Tax Allowance, the largest tax reduction", before: 0, after: 94 });
    expect(rows.tax_reduction_taper.label).toBe("Withdrawn by the taper (£1 for every £3 of total income above the full new State Pension)");
    expect(rows.tax_reduction_taper.after).toBeCloseTo(-50, 6);
    expect(tab.household.filter((row) => row.kind === "part").map((row) => [row.id, row.before, row.after, row.change])).toEqual([
      ["income_tax_total", -123, -79, 44],
    ]);
  });

  it("says when the reduction is more than the income tax due", () => {
    // £12,970: £80 of tax, all of it taken off
    const tab = tabFor(80, 0);
    const rows = Object.fromEntries(tab.household.map((row) => [row.id, row]));
    expect(rows.tax_reduction_unused).toMatchObject({ label: "Not used: more than the income tax due", after: -14 });
    expect(rows.tax_reduction_taper).toBeUndefined();
  });
});

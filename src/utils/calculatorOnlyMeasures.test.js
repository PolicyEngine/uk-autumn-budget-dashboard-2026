import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CALCULATOR_ONLY_MEASURES,
  definitionChecked,
  isCalculatorOnly,
  publishedRequest,
  removableFromSelection,
  resultPolicies,
  withCalculatorOnly,
  withoutCalculatorOnly,
} from "./calculatorOnlyMeasures";
import { policyRows } from "./singleYear";

const CASH_ISA_LIMIT_ID = "cash_isa_limit_kept";
const MACHINE_GAMES_DUTY_ID = "machine_games_duty_rise";
// Calculator-only until it was published as a static costing (11 November
// 2026): now a measure like any other, selected in the header or not asked
const SAVINGS_INCOME_RATES_ID = "savings_income_rates_up";

describe("calculator-only measures", () => {
  it("always go after the selected measures, once, and come off for the national figures", () => {
    expect(withCalculatorOnly(["a", "b"])).toEqual(["a", "b", CASH_ISA_LIMIT_ID, MACHINE_GAMES_DUTY_ID]);
    expect(withCalculatorOnly(["a", CASH_ISA_LIMIT_ID])).toEqual(["a", CASH_ISA_LIMIT_ID, MACHINE_GAMES_DUTY_ID]);
    // Nothing selected: no request, so nothing added
    expect(withCalculatorOnly([])).toEqual([]);
    expect(withoutCalculatorOnly(["a", CASH_ISA_LIMIT_ID, MACHINE_GAMES_DUTY_ID])).toEqual(["a"]);
  });

  it("are the cash ISA limit and the Machine Games Duty rise, and no longer the savings rise", () => {
    expect(Object.keys(CALCULATOR_ONLY_MEASURES)).toEqual([CASH_ISA_LIMIT_ID, MACHINE_GAMES_DUTY_ID]);
    expect(isCalculatorOnly(SAVINGS_INCOME_RATES_ID)).toBe(false);
    // Not added to a request that does not select it, and kept, in its
    // place, in one that does: the national figures carry it too
    expect(withCalculatorOnly(["a"])).not.toContain(SAVINGS_INCOME_RATES_ID);
    expect(withCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID])).toEqual(["a", SAVINGS_INCOME_RATES_ID, CASH_ISA_LIMIT_ID, MACHINE_GAMES_DUTY_ID]);
    expect(withoutCalculatorOnly(["a", SAVINGS_INCOME_RATES_ID, CASH_ISA_LIMIT_ID])).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    // Checked against its approved definition whether or not the
    // publication names it, and removable from the selection as any measure
    expect(definitionChecked(["a", SAVINGS_INCOME_RATES_ID], null)).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    expect(publishedRequest(["a", SAVINGS_INCOME_RATES_ID], () => false)).toEqual(["a", SAVINGS_INCOME_RATES_ID]);
    expect(removableFromSelection([SAVINGS_INCOME_RATES_ID], ["a", SAVINGS_INCOME_RATES_ID])).toBe(true);
    // Counted in the result card's number, not named after it
    expect(resultPolicies(["a", SAVINGS_INCOME_RATES_ID])).toEqual({ count: 2, named: [], text: "2 policies" });
  });

  it("show an assumption's note where the household's figure rests on it", () => {
    const note = "Assumes that under the planned £12,000 limit …";
    const byPolicy = (change) => ({
      measures: [{ id: CASH_ISA_LIMIT_ID, name: "Cash ISA limit", change, status: change ? "affected" : "not_affected", note, noteKind: "assumption" }],
      residual: 0,
    });
    const moved = policyRows(byPolicy(185), 185, [], 2029);
    expect(moved.rows).toEqual([expect.objectContaining({ id: CASH_ISA_LIMIT_ID, name: "Cash ISA limit kept at £20,000", rounded: 185 })]);
    expect(moved.notes).toEqual([{ id: CASH_ISA_LIMIT_ID, name: "Cash ISA limit kept at £20,000", kind: "assumption", text: note }]);
    expect(policyRows(byPolicy(0), 0, [], 2029).notes).toEqual([]);
  });

  it("show in the split by policy with their short name, and no note", () => {
    const byPolicy = {
      measures: [
        { id: "property_income_rates_up", name: "Property income tax rates up", change: 0, status: "not_affected" },
        { id: MACHINE_GAMES_DUTY_ID, name: "Machine Games Duty rise", change: -190, status: "affected" },
      ],
      residual: 0,
    };
    const bars = policyRows(byPolicy, -190, [{ id: "property_income_rates_up", name: "Property income tax up" }], 2027);
    expect(bars.rows).toEqual([expect.objectContaining({ id: MACHINE_GAMES_DUTY_ID, name: CALCULATOR_ONLY_MEASURES[MACHINE_GAMES_DUTY_ID].name, rounded: -190 })]);
    expect(bars.notes).toEqual([]);
  });

  it("leave the savings rise its published name in the split by policy", () => {
    // The catalogue's name for it, as for any published measure; with none
    // (a measure the page does not publish), the API's own
    const byPolicy = { measures: [{ id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax rates up", change: -190, status: "affected" }], residual: 0 };
    expect(policyRows(byPolicy, -190, [{ id: SAVINGS_INCOME_RATES_ID, name: "Published name" }], 2027).rows).toEqual([
      expect.objectContaining({ id: SAVINGS_INCOME_RATES_ID, name: "Published name", rounded: -190 }),
    ]);
    expect(policyRows(byPolicy, -190, [], 2027).rows).toEqual([
      expect.objectContaining({ id: SAVINGS_INCOME_RATES_ID, name: "Savings income tax rates up", rounded: -190 }),
    ]);
  });

  it("are left out of the definitions check only while they have no approved definition", () => {
    const IDS = ["a", "b", "c", CASH_ISA_LIMIT_ID];
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...IDS)), fc.subarray(IDS), (policies, approvedIds) => {
        const checked = definitionChecked(policies, Object.fromEntries(approvedIds.map((id) => [id, {}])));
        // In the request's order, each one at most once
        expect(checked).toEqual(policies.filter((id) => checked.includes(id)));
        // Every measure with published figures is checked, whether or not
        // it has an approved definition (with none, it is refused)
        for (const id of policies) expect(checked.includes(id)).toBe(!isCalculatorOnly(id) || approvedIds.includes(id));
      }),
      { numRuns: 300 },
    );
    expect(definitionChecked(["a", CASH_ISA_LIMIT_ID], null)).toEqual(["a"]);
  });

  it("are checked against the publication once it names them, selected or not", () => {
    // Review of bc51d6d2, finding 1: a published calculator-only measure
    // (the savings rise, then), not selected, went in every request unchecked
    const IDS = ["a", "b", "c", CASH_ISA_LIMIT_ID];
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...IDS)), fc.subarray(IDS), (selected, publishedIds) => {
        const checked = publishedRequest(selected, (id) => publishedIds.includes(id));
        const request = withCalculatorOnly(selected);
        // The request's measures, in its order, each at most once
        expect(checked).toEqual(request.filter((id) => checked.includes(id)));
        // Every selected one; one the request adds exactly when published
        for (const id of selected) expect(checked).toContain(id);
        for (const id of request) expect(checked.includes(id)).toBe(selected.includes(id) || publishedIds.includes(id));
        for (const id of request.filter((added) => !selected.includes(added))) expect(isCalculatorOnly(id)).toBe(true);
        // With the published ones approved, the hooks check the same
        // measures the page approved (definitionChecked)
        const approvals = Object.fromEntries(checked.map((id) => [id, {}]));
        expect(definitionChecked(request, approvals)).toEqual(checked);
      }),
      { numRuns: 300 },
    );
    // With nothing selected there is no request, and nothing to check
    expect(publishedRequest([], () => true)).toEqual([]);
  });

  it("are never offered for removal from the selection: a Remove would change nothing", () => {
    // Re-reviews of 34133276 and edf98756 (P3s): a calculator-only measure
    // goes in every request, selected or not
    const IDS = ["a", "b", "c", CASH_ISA_LIMIT_ID];
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...IDS)), fc.uniqueArray(fc.constantFrom(...IDS)), (selected, refused) => {
        const removable = removableFromSelection(refused, selected);
        expect(removable).toBe(refused.every((id) => selected.includes(id) && !isCalculatorOnly(id)));
        // Offered, it lifts the refusal: the request without them names none
        if (removable) {
          const request = withCalculatorOnly(selected.filter((id) => !refused.includes(id)));
          for (const id of refused) expect(request).not.toContain(id);
        }
      }),
      { numRuns: 300 },
    );
    expect(removableFromSelection([CASH_ISA_LIMIT_ID], ["a", CASH_ISA_LIMIT_ID])).toBe(false);
    expect(removableFromSelection(["a"], ["a", CASH_ISA_LIMIT_ID])).toBe(true);
  });
});

describe("the result card's measures (resultPolicies)", () => {
  const CALCULATOR_ONLY_IDS = Object.keys(CALCULATOR_ONLY_MEASURES);
  // Header selections: distinct catalogue-like ids, never a calculator-only one
  const selection = fc.uniqueArray(
    fc.stringMatching(/^[a-z][a-z_]{0,20}$/).filter((id) => !isCalculatorOnly(id)),
    { minLength: 1, maxLength: 12 },
  );

  it("counts the selection and names the cash ISA limit and the Machine Games Duty rise", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(resultPolicies(withCalculatorOnly(seven))).toEqual({
      count: 7,
      named: ["the cash ISA limit kept at £20,000", "the rise in Machine Games Duty"],
      text: "7 policies, the cash ISA limit kept at £20,000 and the rise in Machine Games Duty",
    });
    expect(resultPolicies(withCalculatorOnly(["a"])).text).toBe(
      "1 policy, the cash ISA limit kept at £20,000 and the rise in Machine Games Duty",
    );
    // Without the calculator's own measures, just the count
    expect(resultPolicies(["a", "b"]).text).toBe("2 policies");
    expect(resultPolicies([]).text).toBe("0 policies");
    // A repeated id counts once
    expect(resultPolicies(["a", "a", CASH_ISA_LIMIT_ID]).text).toBe("1 policy and the cash ISA limit kept at £20,000");
  });

  it("for any selection, counts exactly the selection and names every calculator-only measure", () => {
    fc.assert(
      fc.property(selection, (selected) => {
        const { count, named, text } = resultPolicies(withCalculatorOnly(selected));
        expect(count).toBe(selected.length);
        expect(text.startsWith(`${selected.length} ${selected.length === 1 ? "policy" : "policies"}`)).toBe(true);
        for (const id of CALCULATOR_ONLY_IDS) {
          expect(named).toContain(CALCULATOR_ONLY_MEASURES[id].phrase);
          expect(text).toContain(CALCULATOR_ONLY_MEASURES[id].phrase);
        }
      }),
    );
  });

  it("for any request, the count plus the named measures is every distinct measure, in any order", () => {
    const request = fc.uniqueArray(fc.oneof(fc.constantFrom(...CALCULATOR_ONLY_IDS), fc.stringMatching(/^[a-z][a-z_]{0,20}$/)), { maxLength: 12 });
    fc.assert(
      fc.property(request, (ids) => {
        const { count, named } = resultPolicies(ids);
        expect(count + named.length).toBe(ids.length);
        expect(named).toHaveLength(ids.filter(isCalculatorOnly).length);
        expect(resultPolicies([...ids].reverse()).count).toBe(count);
      }),
    );
  });

  it("gives every calculator-only measure a phrase to name it by", () => {
    for (const measure of Object.values(CALCULATOR_ONLY_MEASURES)) {
      expect(measure.phrase).toMatch(/^the [a-z]/);
    }
  });
});

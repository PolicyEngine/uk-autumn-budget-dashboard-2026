import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { lifecycleSelection, lifecycleTotals } from "./lifecycleSelection";

const years = [2026, 2029];
const measure = (id, overrides = {}) => ({
  id, label: `Measure ${id}`, displayable: true, years, unsupported_years: [], color: "#0D9488",
  personal: { key: `impact_${id}`, model: "lifecycle", reviewed: true, description: `Lifetime model for ${id}.`, years, unsupported_years: [] },
  ...overrides,
});
const alpha = measure("alpha");
const beta = measure("beta", { color: "#78350F" });
const rows = [{ year: 2026, impact_alpha: 10, impact_beta: -200 }, { year: 2029, impact_alpha: 12, impact_beta: -250 }];
const keys = (selection) => selection.reforms.map((reform) => reform.key);
const shared = () => [alpha, beta].map((item) => ({
  ...item, personal: { ...item.personal, key: "impact_shared", policies: ["alpha", "beta"], description: "Reviewed complete shared calculation." },
}));

describe("reviewed lifetime impact contracts", () => {
  it("uses explicit model contracts, published colours and model-specific descriptions", () => {
    const selection = lifecycleSelection(["beta", "alpha"], [alpha, beta], rows);
    expect(keys(selection)).toEqual(["impact_alpha", "impact_beta"]);
    expect(selection.reforms.map((item) => item.color)).toEqual([alpha.color, beta.color]);
    expect(selection.reforms[0].description).toBe(alpha.personal.description);
    expect(selection.unmodelled).toEqual([]);
    expect(lifecycleTotals(rows, selection.reforms)).toEqual({ netTotal: -428, avgPerYear: -214 });
  });

  it("requires all members of a consistently declared shared series", () => {
    const data = [{ year: 2026, impact_shared: 30 }];
    const partial = lifecycleSelection(["alpha"], shared(), data);
    expect(keys(partial)).toEqual([]);
    expect(partial.partialCombined).toBe(true);
    expect(partial.unmodelled).toEqual([alpha.label]);
    const full = lifecycleSelection(["alpha", "beta"], shared(), data);
    expect(keys(full)).toEqual(["impact_shared"]);
    expect(lifecycleTotals(data, full.reforms).netTotal).toBe(30);
  });

  it.each([
    ["undeclared owner", [alpha, { ...beta, personal: { ...beta.personal, key: alpha.personal.key } }]],
    ["missing member mapping", [shared()[0], beta]],
    ["different groups", [shared()[0], { ...shared()[1], personal: { ...shared()[1].personal, policies: ["beta"] } }]],
    ["different model parameters", [shared()[0], { ...shared()[1], personal: { ...shared()[1].personal, description: "Different implementation." } }]],
    ["duplicate members", shared().map((item) => ({ ...item, personal: { ...item.personal, policies: ["alpha", "beta", "alpha"] } }))],
    ["held member", [shared()[0], { ...shared()[1], displayable: false }]],
  ])("rejects invalid shared ownership: %s", (_, measures) => {
    const selection = lifecycleSelection(["alpha", "beta"], measures, [{ year: 2026, impact_shared: 30, impact_alpha: 10, impact_beta: 20 }]);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([alpha.label, beta.label]);
  });

  it("requires publication years and personal years for every row", () => {
    const selection = lifecycleSelection(["alpha"], [{ ...alpha, years: [2029], unsupported_years: [2026] }], rows);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([alpha.label]);
    for (const personal of [
      { key: "impact_alpha" },
      { ...alpha.personal, years: undefined },
      { ...alpha.personal, reviewed: false },
      { ...alpha.personal, model: "personal" },
      { ...alpha.personal, years: [2029], unsupported_years: [2026] },
    ]) expect(lifecycleSelection(["alpha"], [{ ...alpha, personal }], rows).reforms).toEqual([]);
  });

  it("does not restore personal figures after publication receipt verification fails", () => {
    const selection = lifecycleSelection([alpha.id], [{ ...alpha, availability: { available: false, reason: "Receipt digest mismatch" } }], rows);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([alpha.label]);
  });

  it("withholds totals when any selection or supported year is missing", () => {
    expect(lifecycleTotals(rows, [alpha], false).netTotal).toBeNull();
    expect(lifecycleTotals([{ year: 2030, impact_alpha: 99 }], [alpha]).netTotal).toBeNull();
    expect(lifecycleTotals([{ year: 2026 }], [alpha]).netTotal).toBeNull();
    expect(lifecycleTotals(rows, []).netTotal).toBeNull();
  });

  it("never infers an impact from arbitrary ids or impact-prefixed API columns", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), fc.integer(), (id, value) => {
      const published = measure(id, { personal: null });
      const data = [{ year: 2026, [id]: value, [`impact_${id}`]: value, gross_income: value }];
      const selection = lifecycleSelection([id], [published], data);
      expect(selection.reforms).toEqual([]);
      expect(selection.unmodelled).toEqual([published.label]);
    }));
  });

  it("rejects explicit mappings to non-impact numeric columns", () => {
    fc.assert(fc.property(fc.constantFrom("gross_income", "year", "age", "baseline_net_income", "income_tax", "student_loan_payment"), fc.integer(), (key, value) => {
      const published = measure(key, { personal: { ...alpha.personal, key } });
      const selection = lifecycleSelection([key], [published], [{ [key]: value, year: 2026 }]);
      expect(selection.reforms).toEqual([]);
      expect(selection.unmodelled).toEqual([published.label]);
    }));
  });

  it("never authorizes a lifetime projection containing an unsupported year", () => {
    fc.assert(fc.property(fc.integer({ min: 2027, max: 2100 }).filter((year) => year !== 2029), fc.integer(), (year, value) => {
      const selection = lifecycleSelection([alpha.id], [alpha], [{ year: 2026, impact_alpha: 10 }, { year, impact_alpha: value }]);
      expect(selection.reforms).toEqual([]);
      expect(selection.unmodelled).toEqual([alpha.label]);
    }));
  });
});

// The round-1 review's reproductions, kept verbatim as regressions
describe("review round 1 reproductions", () => {
  it("finding 4: a measure id that names an API column is not an impact", () => {
    // A published measure with id gross_income read £30,000 of earnings as
    // £30,000 of policy impact, with no not-modelled notice
    const grossIncome = measure("gross_income", { personal: null });
    const data = [{ year: 2026, gross_income: 30_000, impact_gross_income: 30_000 }];
    const selection = lifecycleSelection(["gross_income"], [grossIncome], data);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([grossIncome.label]);
    expect(lifecycleTotals(data, selection.reforms, selection.unmodelled.length === 0).netTotal).toBeNull();
  });

  it("finding 4: two measures on one series without a declared group are both not modelled", () => {
    const one = measure("one", { personal: { ...alpha.personal, key: "impact_shared" } });
    const two = measure("two", { personal: { ...alpha.personal, key: "impact_shared" } });
    const selection = lifecycleSelection(["one", "two"], [one, two], [{ year: 2026, impact_shared: 5 }, { year: 2029, impact_shared: 5 }]);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([one.label, two.label]);
  });

  it("finding 5: an unsupported year never enters a lifetime total", () => {
    // years [2029], unsupported_years [2026], £100 in 2026 and £20 in 2029
    // returned a complete £120
    const limited = measure("limited", {
      years: [2029], unsupported_years: [2026],
      personal: { ...alpha.personal, key: "impact_limited", years: [2026, 2029] },
    });
    const data = [{ year: 2026, impact_limited: 100 }, { year: 2029, impact_limited: 20 }];
    const selection = lifecycleSelection(["limited"], [limited], data);
    expect(selection.reforms).toEqual([]);
    expect(selection.unmodelled).toEqual([limited.label]);
    expect(lifecycleTotals(data, [limited]).netTotal).toBeNull();
  });
});

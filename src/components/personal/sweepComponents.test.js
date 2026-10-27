import { describe, expect, it } from "vitest";
import { SWEEP_COMPONENTS, TOTAL_TIP, componentEffect, noEffectNote, sharedChipTip, sharedSweepChips } from "./sweepComponents";

const component = (key) => SWEEP_COMPONENTS.find((c) => c.key === key);
const tipOf = (chips, key) => chips.find((chip) => chip.key === key).tip;

describe("the shared Across earnings key's no-effect tips", () => {
  // A household with earnings, income tax and NI on both charts, Council
  // Tax and fuel duty on net income only, and the allowance taper on the rate only
  const net = new Set(["market_income", "income_tax", "national_insurance", "council_tax", "fuel_duty"]);
  const rate = new Set(["income_tax", "national_insurance", "personal_allowance_taper"]);
  const chips = sharedSweepChips(net, rate);

  it("finds, per component, which chart it has an effect on", () => {
    expect(componentEffect(component("income_tax"), net, rate)).toEqual({ net: true, rate: true });
    expect(componentEffect(component("council_tax"), net, rate)).toEqual({ net: true, rate: false });
    expect(componentEffect(component("pa_taper"), net, rate)).toEqual({ net: false, rate: true });
    expect(componentEffect(component("universal_credit"), net, rate)).toEqual({ net: false, rate: false });
    // Child Benefit is two net parts: either one counts
    expect(componentEffect(component("child_benefit"), new Set(["child_benefit_charge"]), new Set())).toEqual({ net: true, rate: false });
  });

  it("says where a component has no effect, and which chart it is on", () => {
    expect(noEffectNote(component("income_tax"), { net: true, rate: true })).toBeNull();
    expect(noEffectNote(component("council_tax"), { net: true, rate: false })).toBe(
      "Council Tax: no effect on your marginal tax rate — shown on Household net income only.",
    );
    expect(noEffectNote(component("universal_credit"), { net: false, rate: true })).toBe(
      "Universal Credit: no effect on your net income — shown on Marginal tax rate across earnings only.",
    );
    expect(noEffectNote(component("universal_credit"), { net: false, rate: false })).toBe(
      "Universal Credit: no effect on either chart for you.",
    );
    // Never on a chart for anyone: why, not "no effect"
    expect(noEffectNote(component("pa_taper"), { net: false, rate: true })).toBe(
      "Personal allowance taper: shown on Marginal tax rate across earnings only — on net income it is counted in income tax.",
    );
    expect(noEffectNote(component("earnings"), { net: true, rate: false })).toBe(
      "Earnings and other income: shown on Household net income only — the marginal tax rate is taken from earnings, not made of them.",
    );
  });

  it("gives every chip a tip: what it is, after the no-effect note where there is one", () => {
    expect(tipOf(chips, "income_tax")).toBe("Tax on income above the personal allowance.");
    expect(tipOf(chips, "council_tax")).toBe(
      "Council Tax: no effect on your marginal tax rate — shown on Household net income only. The local tax on your home, set by your council.",
    );
    expect(tipOf(chips, "fuel_duty")).toMatch(/^Fuel duty: no effect on your marginal tax rate — shown on Household net income only\. /);
    expect(tipOf(chips, "student_loan")).toMatch(/^Student loan: no effect on either chart for you\. /);
    expect(tipOf(chips, "total")).toBe(TOTAL_TIP);
    // Every component has a one-line description, and every chip a tip
    SWEEP_COMPONENTS.forEach((c) => expect(c.about).toMatch(/^[A-Z].+\.$/));
    chips.forEach((chip) => expect(chip.tip).toBeTruthy());
    expect(sharedChipTip(component("income_tax"), { net: true, rate: true })).toBe(component("income_tax").about);
  });

  it("folds the components with no effect on either chart, and only those", () => {
    const folded = chips.filter((chip) => chip.folded).map((chip) => chip.key);
    expect(folded).toContain("student_loan");
    expect(folded).not.toContain("council_tax");
    expect(folded).not.toContain("pa_taper");
  });
});

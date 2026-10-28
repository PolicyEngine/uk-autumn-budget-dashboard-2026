import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { categoryIcon, measureCategoryOf, OTHER_CATEGORY } from "./measureCategory";
import MeasureRowLabel from "../components/MeasureRowLabel";

// Tonight's measures as the live manifest names them (ids, names and the
// start of each description): the derivation must place each one without
// a list of ids of its own
const CURRENT = [
  ["badr_lifetime_limit_cut", "Business Asset Disposal Relief restricted", "From 6 April 2027 the lifetime limit on gains qualifying for Business Asset Disposal Relief falls", "Capital gains tax", "trend"],
  ["domestic_electricity_zero_vat", "Zero VAT on domestic electricity", "VAT on domestic electricity is 0% instead of 5%", "VAT", "receipt"],
  ["employer_ni_relief_under_25s", "Employer NI relief for under-25s", "employers pay no secondary Class 1 National Insurance", "National Insurance", "briefcase"],
  ["fuel_duty_rise_deferral", "Fuel duty rises deferred", "Fuel duty stays at 52.95p a litre. Includes the VAT on the lower pump price.", "Fuel duty", "fuel"],
  ["plan_2_threshold_unfreeze", "Plan 2 student loan threshold unfrozen", "The Plan 2 student loan repayment threshold rises with RPI", "Student loans", "cap"],
  ["road_fuel_vat_cut", "VAT cut on road fuel", "VAT on petrol and diesel falls from 20% to 15%", "VAT", "receipt"],
  ["state_pension_income_tax_protection", "State Pension income tax protection", "people over State Pension age get an income tax allowance", "Income tax", "wallet"],
  ["threshold_freeze_2031_32", "Threshold freeze to 2031-32", "Candidate measure. The income tax personal allowance stays at £12,570 and the basic rate band at £37,700 (a higher rate threshold of £50,270) for one more year. From 2031-32 policyengine-uk sets the National Insurance primary threshold and upper earnings limit at the personal allowance and higher rate threshold.", "Income tax", "wallet"],
  ["lha_unfreeze_2027", "Local Housing Allowance unfrozen", "Candidate measure. From April 2027 Local Housing Allowance rates are no longer frozen", "Benefits", "piggy"],
  ["employer_nics_secondary_threshold_raise", "Employer NI threshold raised", "Candidate measure. From 6 April 2027 the threshold above which employers pay Class 1 National Insurance goes back", "National Insurance", "briefcase"],
  ["unearned_income_rates_up", "Dividend, savings and property income tax up", "Candidate measure. From 6 April 2027 the income tax rates on dividends, savings income and property income each rise", "Income tax", "wallet"],
  ["property_income_rates_up", "Property income tax rates up", "From 6 April 2027 the income tax rates on property income rise", "Income tax", "wallet"],
  ["savings_income_rates_up", "Savings income tax rates up", "From 6 April 2027 the income tax rates on savings income rise", "Income tax", "wallet"],
  ["warm_home_discount_top_up", "Warm Home Discount top-up", "£100 more to each household receiving Universal Credit, Pension Credit", "Energy", "flame"],
];

describe("measureCategoryOf", () => {
  it.each(CURRENT)("places %s", (id, name, description, label, icon) => {
    expect(measureCategoryOf({ id, name, label: name, description })).toEqual({ label, icon });
  });

  it("places a measure by its id alone, as a row with no published name would be", () => {
    expect(measureCategoryOf({ id: "plan_2_threshold_unfreeze" }).label).toBe("Student loans");
    expect(measureCategoryOf({ id: "council_tax_revaluation" }).label).toBe("Council tax");
    expect(measureCategoryOf({ id: "two_child_limit_abolition" }).label).toBe("Benefits");
    expect(measureCategoryOf({ id: "childcare_100k_taper" }).label).toBe("Childcare");
    expect(measureCategoryOf({ id: "stamp_duty_holiday" }).label).toBe("Property");
    expect(measureCategoryOf({ id: "triple_lock_plus" }).label).toBe("Pensions");
    // A threshold alone says nothing of the tax: these are not income tax
    expect(measureCategoryOf({ id: "pension_credit_threshold" }).label).toBe("Pensions");
    expect(measureCategoryOf({ id: "uc_work_allowance_threshold" }).label).toBe("Benefits");
  });

  it("gives an unknown Budget-day measure a sensible category and icon", () => {
    expect(measureCategoryOf({ id: "budget_2026_new_levy" })).toEqual({ label: "Business", icon: "building" });
    expect(measureCategoryOf({ id: "budget_2026_mystery", name: "Something new" })).toEqual(OTHER_CATEGORY);
    for (const nothing of [null, undefined, {}, { id: "" }, { name: 3 }]) {
      expect(measureCategoryOf(nothing)).toEqual(OTHER_CATEGORY);
    }
  });

  it("takes the publication's own category first, with the icon its words call for", () => {
    expect(measureCategoryOf({ id: "road_fuel_vat_cut", name: "VAT cut on road fuel", category: "Fuel duty" })).toEqual({ label: "Fuel duty", icon: "fuel" });
    expect(measureCategoryOf({ id: "x", name: "Fuel duty frozen", category: "Gambling" })).toEqual({ label: "Gambling", icon: "tag" });
    expect(categoryIcon("Income tax")).toBe("wallet");
    expect(categoryIcon(null)).toBe("tag");
  });
});

describe("MeasureRowLabel", () => {
  it("draws an unknown measure with an icon and its name, without crashing; the category only on request", () => {
    const { container } = render(<MeasureRowLabel measure={{ id: "budget_2026_new_levy", name: "New levy" }} />);
    expect(container.querySelector(".mrl-icon svg")).toBeTruthy();
    expect(container.querySelector(".mrl-name")).toHaveTextContent("New levy");
    expect(container.querySelector(".mrl-caption")).toBeNull();
    const { container: withCaption } = render(<MeasureRowLabel caption measure={{ id: "budget_2026_new_levy", name: "New levy" }} />);
    expect(withCaption.querySelector(".mrl-caption")).toHaveTextContent("Business");
  });

  it("drops the caption in its compact form", () => {
    const { container } = render(<MeasureRowLabel compact caption measure={{ id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred" }} />);
    expect(container.querySelector(".mrl--compact .mrl-icon svg")).toBeTruthy();
    expect(container.querySelector(".mrl-caption")).toBeNull();
  });
});

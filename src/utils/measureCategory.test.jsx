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
  ["warm_home_discount_top_up", "Warm Home Discount top-up", "£100 more to each household receiving Universal Credit, Pension Credit", "Energy", "flame"],
];

describe("measureCategoryOf", () => {
  it.each(CURRENT)("places %s", (id, name, description, label, icon) => {
    expect(measureCategoryOf({ id, name, label: name, description })).toEqual({ label, icon });
  });

  // Every measure imported from a past event's replay (#107), by its
  // record's id and name: each is placed by its tax or benefit, never by a
  // word another category uses ("Winter Fuel", the SDLT "Higher Rate")
  it("places every past event's imported measure by its own tax or benefit", () => {
    const records = import.meta.glob("../uk_budget_data/events/*.json", { eager: true, import: "default" });
    const placed = Object.fromEntries(
      Object.values(records).flatMap((record) => record.measures.map((measure) => [measure.id, measureCategoryOf({ id: measure.id, name: measure.name, label: measure.name }).label])),
    );
    expect(placed).toEqual({
      autumn_budget_2024__capital_gains_main_rates_and_reliefs: "Capital gains tax",
      autumn_budget_2024__employer_nics_package: "National Insurance",
      autumn_budget_2024__private_school_vat_20pct: "VAT",
      autumn_budget_2024__sdlt_additional_dwelling_surcharge_2pp: "Property",
      autumn_budget_2024__winter_fuel_means_test: "Benefits",
      ab2025__dividend_rates_plus_2pp: "Income tax",
      ab2025__employer_nics_secondary_threshold_freeze_to_2031: "National Insurance",
      ab2025__high_value_council_tax_surcharge: "Council tax",
      ab2025__personal_tax_thresholds_freeze_to_2031: "Income tax",
      ab2025__property_income_separate_rates: "Income tax",
      ab2025__salary_sacrifice_pension_nics_cap_2000: "National Insurance",
      ab2025__savings_rates_plus_2pp_and_starter_limit_held: "Income tax",
      ab2025__uc_child_element_remove_two_child_limit: "Benefits",
      ab2025__winter_fuel_payment_income_test_35000: "Benefits",
      autumn_statement_2023__class_1_employee_nics_main_rate_cut_2p: "National Insurance",
      autumn_statement_2023__class_2_self_employed_nics_abolition: "National Insurance",
      autumn_statement_2023__class_4_self_employed_nics_main_rate_cut_1p: "National Insurance",
      autumn_statement_2023__lha_reset_to_30th_percentile: "Benefits",
      spring_budget_2023__pension_annual_allowance_package: "Pensions",
      spring_budget_2023__uc_childcare_cap_increase: "Childcare",
      spring_budget_2024__class_1_employee_nics_main_rate_cut_2pp: "National Insurance",
      spring_budget_2024__class_4_self_employed_nics_main_rate_cut_2pp: "National Insurance",
      spring_budget_2024__hicbc_threshold_and_taper: "Benefits",
      spring_statement_2025__uc_health_element_freeze_and_new_claimant_cut: "Benefits",
      spring_statement_2025__uc_standard_allowance_above_inflation: "Benefits",
    });
    // By its id alone too, as a row with no published name would be
    expect(measureCategoryOf({ id: "autumn_budget_2024__winter_fuel_means_test" }).label).toBe("Benefits");
    expect(measureCategoryOf({ id: "autumn_budget_2024__sdlt_additional_dwelling_surcharge_2pp" }).label).toBe("Property");
    expect(measureCategoryOf({ id: "autumn_statement_2023__lha_reset_to_30th_percentile" }).label).toBe("Benefits");
  });

  it("still places fuel, pensions, property and income tax by their own words", () => {
    expect(measureCategoryOf({ name: "Fuel duty rises deferred" }).label).toBe("Fuel duty");
    expect(measureCategoryOf({ name: "Higher rate threshold frozen" }).label).toBe("Income tax");
    expect(measureCategoryOf({ name: "Housing support for renters" }).label).toBe("Property");
    expect(measureCategoryOf({ id: "pension_credit_threshold" }).label).toBe("Pensions");
  });

  it("places a scheme named first in a description by the scheme", () => {
    const described = (description) => measureCategoryOf({ id: "m1", description }).label;
    expect(described("The Winter Fuel Payment goes to pensioners on Pension Credit")).toBe("Benefits");
    expect(described("Stamp Duty Land Tax's higher rate for additional dwellings rises")).toBe("Property");
    expect(described("Local Housing Allowance rates return to the 30th percentile of rents")).toBe("Benefits");
    // A scheme named after another tax does not displace it
    expect(described("Fuel duty is frozen, and the Winter Fuel Payment is unchanged")).toBe("Fuel duty");
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
  it("draws an unknown measure with an icon, its name and a category, without crashing", () => {
    const { container } = render(<MeasureRowLabel measure={{ id: "budget_2026_new_levy", name: "New levy" }} />);
    expect(container.querySelector(".mrl-icon svg")).toBeTruthy();
    expect(container.querySelector(".mrl-name")).toHaveTextContent("New levy");
    expect(container.querySelector(".mrl-caption")).toHaveTextContent("Business");
  });

  it("drops the caption in its compact form", () => {
    const { container } = render(<MeasureRowLabel compact measure={{ id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred" }} />);
    expect(container.querySelector(".mrl--compact .mrl-icon svg")).toBeTruthy();
    expect(container.querySelector(".mrl-caption")).toBeNull();
  });
});

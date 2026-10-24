import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import HouseholdCalculator, { FORM_SECTIONS, WIZARD_DEFAULTS, resetSavedWizard } from "./HouseholdCalculator";
import { DEFAULT_SALARY, DEFAULT_SPENDING, REGIONAL_RENT } from "../utils/householdDefaults";

beforeEach(() => {
  resetSavedWizard();
});

/** A question's row button, by the field it asks. */
const rowButton = (id) => document.querySelector(`[data-row="${id}"] > button`);
/** The answer a closed row shows. */
const rowValue = (id) => document.querySelector(`[data-row="${id}"] .household-row-value`).textContent;
/** Open a question's row (one at a time). */
const open = (id) => {
  const button = rowButton(id);
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
};
const group = (name) => screen.getByRole("radiogroup", { name });
const choose = (groupName, option) =>
  fireEvent.click(within(group(groupName)).getByRole("radio", { name: option }));
const box = (name) => screen.getByRole("spinbutton", { name });
const rows = () => [...document.querySelectorAll(".household-row")].map((row) => row.dataset.row);
const pounds = (value) => `£${value.toLocaleString("en-GB")}`;

describe("the personal impact form", () => {
  it("is one list of questions, each showing its answer, the essentials first, with the results beside it", () => {
    render(<HouseholdCalculator />);
    // No steps and no "See results": the results are always there
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See results" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Results" })).toBeInTheDocument();
    expect(rows()).toEqual([
      "current_age",
      "current_salary",
      "region",
      "has_partner",
      "children_count",
      "tenure",
      "monthly_rent",
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
      "petrol_spending_per_year",
      "diesel_spending_per_year",
      "council_tax_band",
      "claims_universal_credit",
    ]);
    expect(screen.getByRole("heading", { level: 3, name: "More details" })).toBeInTheDocument();
    expect(FORM_SECTIONS).toHaveLength(2);
    expect(rowValue("current_age")).toBe("30");
    expect(rowValue("region")).toBe("North West");
    expect(rowValue("has_partner")).toBe("No");
    expect(rowValue("tenure")).toBe("Rent privately");
    expect(rowValue("monthly_rent")).toBe(`${pounds(REGIONAL_RENT.NORTH_WEST)} a month`);
    expect(rowValue("council_tax_band")).toBe("Band D");
  });

  it("opens one row at a time in place, with aria-expanded and aria-controls, and updates its answer", () => {
    render(<HouseholdCalculator />);
    const age = rowButton("current_age");
    expect(age).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(age.getAttribute("aria-controls"));
    expect(panel).not.toBeVisible();
    fireEvent.click(age);
    expect(age).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Age: 1 more" }));
    expect(rowValue("current_age")).toBe("31");

    open("region");
    expect(age).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("spinbutton", { name: "Age" })).not.toBeInTheDocument();
    choose("Region", "London");
    expect(rowValue("region")).toBe("London");
    // The rent follows the region until it is changed
    expect(rowValue("monthly_rent")).toBe(`${pounds(REGIONAL_RENT.LONDON)} a month`);
    fireEvent.click(rowButton("region"));
    expect(rowButton("region")).toHaveAttribute("aria-expanded", "false");
  });

  it("starts every answer at its default, with the sources said", () => {
    render(<HouseholdCalculator />);
    open("current_salary");
    expect(box("Salary in 2026")).toHaveValue(DEFAULT_SALARY);
    expect(screen.getByText(/UK median salary in April 2026 \(ONS Annual Survey of Hours and Earnings/)).toBeInTheDocument();
    open("monthly_rent");
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.NORTH_WEST);
    expect(screen.getByText(/average private rent in North West \(ONS, September 2026\)/)).toBeInTheDocument();
    open("student_loan_plan");
    expect(within(group("Student loan plan")).getByRole("radio", { name: "No loan" })).toBeChecked();
    open("petrol_spending_per_year");
    expect(box("Petrol")).toHaveValue(DEFAULT_SPENDING.petrol);
    open("diesel_spending_per_year");
    expect(box("Diesel")).toHaveValue(DEFAULT_SPENDING.diesel);
    open("claims_universal_credit");
    expect(
      within(group("Would your household claim Universal Credit if entitled?")).getByRole("radio", { name: "Yes" }),
    ).toBeChecked();
    // Only the answers the household calculation reads
    for (const id of ["rail_spending_per_year", "student_loan_balance", "retirement_age"]) {
      expect(rowButton(id)).toBeNull();
    }
    expect(WIZARD_DEFAULTS.student_loan_plan).toBe("NONE");
  });

  it("uses choice boxes with radio semantics, and steppers for amounts", () => {
    render(<HouseholdCalculator />);
    open("region");
    expect(within(group("Region")).getAllByRole("radio")).toHaveLength(12);
    choose("Region", "London");
    open("monthly_rent");
    fireEvent.click(screen.getByRole("button", { name: "Rent: £25 more" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON + 25 - (REGIONAL_RENT.LONDON % 25));
    fireEvent.click(screen.getByRole("button", { name: "Use the regional average" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON);
    open("current_salary");
    fireEvent.change(box("Salary in 2026"), { target: { value: "52000" } });
    expect(rowValue("current_salary")).toBe("£52,000");
  });

  it("asks rent only of renters, and the partner's answers only with a partner", () => {
    render(<HouseholdCalculator />);
    open("tenure");
    choose("Housing", "Own outright");
    expect(rowButton("monthly_rent")).toBeNull();
    expect(rowButton("partner_salary")).toBeNull();
    open("has_partner");
    choose("Do you live with a partner?", "Yes");
    expect(rowValue("partner_age")).toBe("30");
    expect(rowValue("partner_salary")).toBe(pounds(DEFAULT_SALARY));
    expect(rowButton("partner_private_pension_per_year")).not.toBeNull();
  });

  it("asks one age per child, their education from 16, and childcare only with children", () => {
    render(<HouseholdCalculator />);
    expect(rowButton("monthly_childcare")).toBeNull();
    open("children_count");
    choose("Number of children", "2");
    expect(rowValue("children_count")).toBe("2");
    expect(rowValue("child_0")).toBe("Age 5");
    open("child_1");
    fireEvent.change(box("Child 2's age"), { target: { value: "17" } });
    expect(rowValue("child_1")).toBe("Age 17 · in education");
    const education = group("Child 2 in full-time education (non-advanced)");
    expect(within(education).getByRole("radio", { name: "Yes" })).toBeChecked();
    choose("Child 2 in full-time education (non-advanced)", "No");
    expect(rowValue("child_1")).toBe("Age 17 · not in education");
    expect(rowButton("monthly_childcare")).not.toBeNull();
    open("children_count");
    choose("Number of children", "0");
    expect(rowButton("child_0")).toBeNull();
    expect(rowButton("monthly_childcare")).toBeNull();
  });

  it("says why a child of 20 or over is not taken, never dropping them silently", () => {
    render(<HouseholdCalculator />);
    open("children_count");
    choose("Number of children", "1");
    open("child_0");
    fireEvent.change(box("Child 1's age"), { target: { value: "21" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Children are 0 to 19.");
    fireEvent.blur(box("Child 1's age"));
    expect(box("Child 1's age")).toHaveValue(19);
    expect(screen.getByRole("alert")).toHaveTextContent("21 was changed to 19.");
  });

  it("asks private pensions, the partner's only with a partner, and hides the Council Tax band in Northern Ireland", () => {
    render(<HouseholdCalculator />);
    open("private_pension_per_year");
    expect(box("Your private or workplace pension")).toHaveValue(0);
    expect(rowButton("partner_private_pension_per_year")).toBeNull();
    expect(rowButton("council_tax_band")).not.toBeNull();
    open("region");
    choose("Region", "Northern Ireland");
    expect(rowButton("council_tax_band")).toBeNull();
  });

  it("asks the loan plan, never the balance", () => {
    render(<HouseholdCalculator />);
    open("student_loan_plan");
    const plans = within(group("Student loan plan"))
      .getAllByRole("radio")
      .map((radio) => radio.closest("label").querySelector(".choice-tile-label").textContent);
    expect(plans).toEqual(["No loan", "Plan 1", "Plan 2", "Plan 4", "Plan 5", "Postgraduate"]);
    choose("Student loan plan", /^Plan 2/);
    expect(rowValue("student_loan_plan")).toBe("Plan 2");
  });

  it("asks for the State Pension only at State Pension age, prefilled with the full rate", () => {
    render(<HouseholdCalculator year={2029} />);
    expect(rowButton("state_pension_per_year")).toBeNull();
    open("current_age");
    fireEvent.change(box("Age"), { target: { value: "72" } });
    expect(rowValue("state_pension_per_year")).toBe("£13,697 a year");
    open("state_pension_per_year");
    expect(screen.getByText(/Prefilled with the full new State Pension for 2029-30 \(£13,697\)/)).toBeInTheDocument();
    fireEvent.change(box("Your State Pension"), { target: { value: "9000" } });
    expect(rowValue("state_pension_per_year")).toBe("£9,000 a year");
  });

  it("fills the form from a young-person example chip, still editable", () => {
    render(<HouseholdCalculator />);
    const chips = within(screen.getByRole("group", { name: "Start from an example" })).getAllByRole("button");
    expect(chips).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "A 22-year-old renting" }));
    expect(screen.getByRole("button", { name: "A 22-year-old renting" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Rents privately at £900 a month, an illustrative figure\./)).toBeInTheDocument();
    expect(rowValue("current_age")).toBe("22");
    expect(rowValue("current_salary")).toBe("£25,000");
    open("current_salary");
    fireEvent.change(box("Salary in 2026"), { target: { value: "26000" } });
    // Edited: no longer the example as given
    expect(screen.queryByText(/Rents privately at £900 a month/)).not.toBeInTheDocument();
  });

  it("fills the household answers from each example", () => {
    const cases = [
      ["A 22-year-old renting", { plan: "No loan", rent: "£900 a month" }],
      ["A 19-year-old apprentice", { plan: "No loan", rent: "£600 a month" }],
      ["A 23-year-old graduate", { plan: "Plan 2", rent: "£900 a month" }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = render(<HouseholdCalculator />);
      // Start from answers the example must overwrite
      open("has_partner");
      choose("Do you live with a partner?", "Yes");
      open("children_count");
      choose("Number of children", "2");
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(rowValue("region")).toBe("North West");
      expect(rowValue("tenure")).toBe("Rent privately");
      expect(rowValue("monthly_rent")).toBe(expected.rent);
      expect(rowValue("has_partner")).toBe("No");
      expect(rowValue("children_count")).toBe("0");
      expect(rowValue("student_loan_plan")).toBe(expected.plan);
      unmount();
    }
  });
});

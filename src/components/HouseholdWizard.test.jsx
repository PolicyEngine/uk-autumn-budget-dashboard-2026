import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import HouseholdCalculator, { FORM_SECTIONS, WIZARD_DEFAULTS, resetSavedWizard } from "./HouseholdCalculator";
import { DEFAULT_SALARY, DEFAULT_SPENDING } from "../utils/householdDefaults";

beforeEach(() => {
  resetSavedWizard();
});

/** A question's box, by the field it asks (null when not asked). */
const field = (id) => document.querySelector(`[data-row="${id}"]`);
/** The questions shown, in order. */
const fields = () => [...document.querySelectorAll(".household-field")].map((row) => row.dataset.row);
const moreToggle = () => screen.getByRole("button", { name: /^More details/ });
/** Open More details (closed at first). */
const openMore = () => {
  if (moreToggle().getAttribute("aria-expanded") !== "true") fireEvent.click(moreToggle());
};
const select = (name) => screen.getByRole("combobox", { name });
/** Choose an option of a select by its text. */
const choose = (name, option) => {
  const box = select(name);
  fireEvent.change(box, { target: { value: within(box).getByRole("option", { name: option }).value } });
};
/** A select's chosen option, as shown. */
const chosen = (name) => {
  const box = select(name);
  return box.options[box.selectedIndex].textContent;
};
const box = (name) => screen.getByRole("spinbutton", { name });
const examplesButton = () => screen.getByRole("button", { name: "Examples" });
const openExamples = () => {
  if (examplesButton().getAttribute("aria-expanded") !== "true") fireEvent.click(examplesButton());
  return screen.getByRole("menu", { name: "Start from an example" });
};
const exampleItem = (label) =>
  within(openExamples()).getByRole("menuitemradio", { name: new RegExp(`^${label}`) });
const applyExample = (label) => fireEvent.click(exampleItem(label));

describe("the personal impact form", () => {
  it("is one card of boxes in sections, the essentials first and the rest in More details, with the results below it", () => {
    render(<HouseholdCalculator />);
    // No steps and no "See results": the results are always there
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See results" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your household" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "You" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Family and home" })).toBeInTheDocument();
    // More details starts closed, with how many questions it holds
    const more = screen.getByRole("button", { name: "More details 11 questions" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const essentials = ["current_age", "current_salary", "region", "has_partner", "children_count", "tenure", "brma", "monthly_rent"];
    expect(fields()).toEqual(essentials);
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(more.getAttribute("aria-controls"))).toBeVisible();
    for (const name of ["Other income", "Pension and student loan", "Spending", "Council tax and benefits"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(fields()).toEqual([
      ...essentials,
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
      "petrol_spending_per_year",
      "diesel_spending_per_year",
      "electricity_spending_per_year",
      "council_tax_band",
      "claims_universal_credit",
    ]);
    expect(FORM_SECTIONS).toHaveLength(3);
    expect(box("Age")).toHaveValue(30);
    expect(chosen("Region")).toBe("North West");
    expect(chosen("Partner")).toBe("No");
    expect(chosen("Housing")).toBe("Rent privately");
    expect(box("Rent")).toHaveValue(775);
    expect(chosen("Council tax band")).toBe("D");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("changes an answer in its box, with steppers for amounts", () => {
    render(<HouseholdCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "Age: 1 more" }));
    expect(box("Age")).toHaveValue(31);
    choose("Region", "London");
    expect(chosen("Region")).toBe("London");
    // The rental area and the rent follow the region until changed
    expect(chosen("Rental area")).toBe("Inner South East London");
    expect(box("Rent")).toHaveValue(1296);
    fireEvent.click(screen.getByRole("button", { name: "Rent: £25 more" }));
    expect(box("Rent")).toHaveValue(1300);
    fireEvent.click(screen.getByRole("button", { name: "Use the local rate" }));
    expect(box("Rent")).toHaveValue(1296);
    // Another area: its own rate; the areas offered are London's only
    choose("Rental area", "Outer North London");
    expect(box("Rent")).not.toHaveValue(1296);
    expect(within(select("Rental area")).getAllByRole("option").length).toBeGreaterThan(5);
    choose("Region", "Wales");
    expect(chosen("Rental area")).toBe("Cardiff");
    fireEvent.change(box("Salary in 2026"), { target: { value: "52000" } });
    expect(box("Salary in 2026")).toHaveValue(52000);
    expect(within(select("Region")).getAllByRole("option")).toHaveLength(12);
  });

  it("starts every answer at its default, with the sources said", () => {
    render(<HouseholdCalculator />);
    expect(box("Salary in 2026")).toHaveValue(DEFAULT_SALARY);
    expect(screen.getByText(/UK median salary in April 2026 \(ONS Annual Survey of Hours and Earnings/)).toBeInTheDocument();
    expect(box("Rent")).toHaveValue(775);
    expect(
      screen.getByText(
        /Local Housing Allowance rate for a one-bedroom home in Central Greater Manchester \(DWP, 2026-27\)/,
      ),
    ).toBeInTheDocument();
    // A long note is the box's description, behind an "i" by its label
    expect(box("Rent")).toHaveAccessibleDescription(/Local Housing Allowance rate/);
    expect(screen.getByRole("button", { name: "About Rent" })).toBeInTheDocument();
    openMore();
    expect(chosen("Student loan plan")).toBe("No loan");
    expect(box("Petrol")).toHaveValue(DEFAULT_SPENDING.petrol);
    expect(box("Diesel")).toHaveValue(DEFAULT_SPENDING.diesel);
    expect(chosen("Universal Credit")).toBe("Yes");
    // Only the answers the household calculation reads
    for (const id of ["rail_spending_per_year", "student_loan_balance", "retirement_age"]) {
      expect(field(id)).toBeNull();
    }
    expect(WIZARD_DEFAULTS.student_loan_plan).toBe("NONE");
  });

  it("asks rent only of renters, and the partner's answers only with a partner", () => {
    render(<HouseholdCalculator />);
    choose("Housing", "Own outright");
    expect(field("monthly_rent")).toBeNull();
    expect(field("partner_salary")).toBeNull();
    choose("Partner", "Yes");
    expect(box("Partner's age")).toHaveValue(30);
    expect(box("Partner's salary in 2026")).toHaveValue(DEFAULT_SALARY);
    openMore();
    expect(field("partner_private_pension_per_year")).not.toBeNull();
  });

  it("asks one age per child, their education from 16, and childcare only with children", () => {
    render(<HouseholdCalculator />);
    openMore();
    expect(field("monthly_childcare")).toBeNull();
    choose("Children", "2");
    expect(chosen("Children")).toBe("2");
    expect(box("Child 1's age")).toHaveValue(5);
    expect(screen.queryByRole("combobox", { name: /Child 1 in full-time education/ })).toBeNull();
    fireEvent.change(box("Child 2's age"), { target: { value: "17" } });
    expect(chosen("Child 2 in full-time education (non-advanced)")).toBe("Yes");
    choose("Child 2 in full-time education (non-advanced)", "No");
    expect(chosen("Child 2 in full-time education (non-advanced)")).toBe("No");
    expect(field("monthly_childcare")).not.toBeNull();
    choose("Children", "0");
    expect(field("child_0")).toBeNull();
    expect(field("monthly_childcare")).toBeNull();
  });

  it("says why a child of 20 or over is not taken, never dropping them silently", () => {
    render(<HouseholdCalculator />);
    choose("Children", "1");
    fireEvent.change(box("Child 1's age"), { target: { value: "21" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Children are 0 to 19.");
    fireEvent.blur(box("Child 1's age"));
    expect(box("Child 1's age")).toHaveValue(19);
    expect(screen.getByRole("alert")).toHaveTextContent("21 was changed to 19.");
  });

  it("asks private pensions, the partner's only with a partner, and hides the Council Tax band in Northern Ireland", () => {
    render(<HouseholdCalculator />);
    openMore();
    expect(box("Private or workplace pension")).toHaveValue(0);
    expect(field("partner_private_pension_per_year")).toBeNull();
    expect(field("council_tax_band")).not.toBeNull();
    choose("Region", "Northern Ireland");
    expect(field("council_tax_band")).toBeNull();
  });

  it("asks the loan plan, never the balance, with the chosen plan's note", () => {
    render(<HouseholdCalculator />);
    openMore();
    const plans = within(select("Student loan plan"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(plans).toEqual(["No loan", "Plan 1", "Plan 2", "Plan 4", "Plan 5", "Postgraduate"]);
    choose("Student loan plan", "Plan 2");
    expect(chosen("Student loan plan")).toBe("Plan 2");
    expect(select("Student loan plan")).toHaveAccessibleDescription("England or Wales, Sept 2012 to July 2023");
  });

  it("asks for the State Pension only at State Pension age, prefilled with the full rate", () => {
    render(<HouseholdCalculator year={2029} />);
    openMore();
    expect(field("state_pension_per_year")).toBeNull();
    fireEvent.change(box("Age"), { target: { value: "72" } });
    expect(box("Your State Pension")).toHaveValue(13697);
    expect(screen.getByText(/Prefilled with the full new State Pension for 2029-30 \(£13,697\)/)).toBeInTheDocument();
    fireEvent.change(box("Your State Pension"), { target: { value: "9000" } });
    expect(box("Your State Pension")).toHaveValue(9000);
  });

  it("fills the form from an example, still editable", () => {
    render(<HouseholdCalculator />);
    const menu = openExamples();
    // Two groups, each item a name and one line on what it shows
    expect(within(menu).getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual([
      "Young people",
      "Other households",
    ]);
    const young = within(within(menu).getByRole("group", { name: "Young people" })).getAllByRole("menuitemradio");
    expect(young.map((item) => item.querySelector(".example-menu-name").textContent)).toEqual([
      "A 22-year-old renting",
      "A 19-year-old apprentice",
      "A 23-year-old graduate",
    ]);
    expect(young.every((item) => item.querySelector(".example-menu-description").textContent.length > 0)).toBe(true);
    applyExample("A 22-year-old renting");
    // Chosen: the menu closes, and the example is marked when it opens again
    expect(screen.queryByRole("menu")).toBeNull();
    expect(exampleItem("A 22-year-old renting")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText(/Rents privately at £900 a month, an illustrative figure\./)).toBeInTheDocument();
    expect(box("Age")).toHaveValue(22);
    expect(box("Salary in 2026")).toHaveValue(25000);
    fireEvent.change(box("Salary in 2026"), { target: { value: "26000" } });
    // Edited: no longer the example as given
    expect(screen.queryByText(/Rents privately at £900 a month/)).not.toBeInTheDocument();
    expect(exampleItem("A 22-year-old renting")).toHaveAttribute("aria-checked", "false");
  });

  it("fills the household answers from each example", () => {
    const cases = [
      ["A 22-year-old renting", { plan: "No loan", rent: 900 }],
      ["A 19-year-old apprentice", { plan: "No loan", rent: 600 }],
      ["A 23-year-old graduate", { plan: "Plan 2", rent: 900 }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = render(<HouseholdCalculator />);
      // Start from answers the example must overwrite
      choose("Partner", "Yes");
      choose("Children", "2");
      applyExample(label);
      expect(chosen("Region")).toBe("North West");
      expect(chosen("Housing")).toBe("Rent privately");
      expect(box("Rent")).toHaveValue(expected.rent);
      expect(chosen("Partner")).toBe("No");
      expect(chosen("Children")).toBe("0");
      openMore();
      expect(chosen("Student loan plan")).toBe(expected.plan);
      unmount();
    }
  });

  it("keeps More details open across a remount in the session", () => {
    const { unmount } = render(<HouseholdCalculator />);
    openMore();
    unmount();
    render(<HouseholdCalculator />);
    expect(moreToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows More details' boxes when opened, focusable, in a container no utility class hides", () => {
    render(<HouseholdCalculator />);
    openMore();
    for (const name of ["Savings interest", "Petrol"]) {
      const input = box(name);
      expect(input).toBeVisible();
      input.focus();
      expect(document.activeElement).toBe(input);
    }
    const credit = select("Universal Credit");
    expect(credit).toBeVisible();
    credit.focus();
    expect(document.activeElement).toBe(credit);
    // Tailwind's "collapse" utility is visibility: collapse: the expander
    // must never carry that class
    const panel = document.getElementById(moreToggle().getAttribute("aria-controls"));
    expect(panel).not.toHaveClass("collapse");
    expect(panel.querySelector(".collapse")).toBeNull();
  });
});

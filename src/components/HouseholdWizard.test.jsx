import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import HouseholdCalculator, { WIZARD_DEFAULTS, resetSavedWizard } from "./HouseholdCalculator";
import { DEFAULT_SALARY, DEFAULT_SPENDING, REGIONAL_RENT } from "../utils/householdDefaults";

beforeEach(() => {
  resetSavedWizard();
});

const steps = () => screen.getByRole("navigation", { name: "Steps" });
const group = (name) => screen.getByRole("radiogroup", { name });
const choose = (groupName, option) =>
  fireEvent.click(within(group(groupName)).getByRole("radio", { name: option }));
const box = (name) => screen.getByRole("spinbutton", { name });
const moreDetails = () => fireEvent.click(screen.getByRole("button", { name: "More details (optional)" }));

describe("the personal impact form", () => {
  it("has two steps and the results, and reaches the results from the first", () => {
    render(<HouseholdCalculator />);
    expect(
      within(steps())
        .getAllByRole("button")
        .map((b) => b.textContent.replace(/^[0-9✓]+Step \d+: /, "")),
    ).toEqual(["Your household", "More details", "Results"]);
    expect(within(steps()).getByRole("button", { current: "step" })).toHaveTextContent("Your household");
    // Every step is open: every answer has a default
    within(steps())
      .getAllByRole("button")
      .forEach((button) => expect(button).not.toBeDisabled());

    // The essentials on step 1; the optional details on step 2
    expect(box("Age")).toBeInTheDocument();
    expect(box("Salary in 2026")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Dividends" })).not.toBeInTheDocument();

    // Straight to the results, skipping the optional step
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("heading", { level: 3, name: "Results" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(box("Age")).toBeInTheDocument();

    moreDetails();
    expect(screen.getByRole("heading", { level: 3, name: "More details" })).toHaveFocus();
    expect(box("Dividends")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(box("Age")).toBeInTheDocument();
  });

  it("starts every answer at its default, with the sources said", () => {
    render(<HouseholdCalculator />);
    expect(box("Age")).toHaveValue(30);
    expect(box("Salary in 2026")).toHaveValue(DEFAULT_SALARY);
    expect(screen.getByText(/UK median salary in April 2026 \(ONS Annual Survey of Hours and Earnings/)).toBeInTheDocument();
    expect(within(group("Region")).getByRole("radio", { name: "North West" })).toBeChecked();
    expect(within(group("Do you live with a partner?")).getByRole("radio", { name: "No" })).toBeChecked();
    expect(within(group("Number of children")).getByRole("radio", { name: "0" })).toBeChecked();
    expect(within(group("Housing")).getByRole("radio", { name: "Rent privately" })).toBeChecked();
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.NORTH_WEST);
    expect(screen.getByText(/average private rent in North West \(ONS, September 2026\)/)).toBeInTheDocument();
    expect(within(group("Student loan plan")).getByRole("radio", { name: "No loan" })).toBeChecked();

    moreDetails();
    expect(box("Petrol")).toHaveValue(DEFAULT_SPENDING.petrol);
    expect(box("Diesel")).toHaveValue(DEFAULT_SPENDING.diesel);
    // Rail fares are not asked: no measure the household calculation
    // models reads them
    expect(screen.queryByRole("spinbutton", { name: "Rail fares" })).not.toBeInTheDocument();
    expect(box("Savings interest")).toHaveValue(0);
    expect(box("Pension paid by salary sacrifice")).toHaveValue(0);
    expect(within(group("Council tax band")).getByRole("radio", { name: "D" })).toBeChecked();
    expect(
      within(group("Would your household claim Universal Credit if entitled?")).getByRole("radio", { name: "Yes" }),
    ).toBeChecked();
    // Only the answers the household calculation reads
    for (const name of ["Student loan balance", "Retirement age", "Life expectancy"]) {
      expect(screen.queryByRole("spinbutton", { name })).not.toBeInTheDocument();
    }
    expect(WIZARD_DEFAULTS.student_loan_plan).toBe("NONE");
  });

  it("uses choice boxes with radio semantics, and steppers for amounts", () => {
    render(<HouseholdCalculator />);
    const regions = within(group("Region")).getAllByRole("radio");
    expect(regions).toHaveLength(12);
    choose("Region", "London");
    expect(within(group("Region")).getByRole("radio", { name: "London" })).toBeChecked();
    // The rent follows the region until it is changed
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON);

    fireEvent.click(screen.getByRole("button", { name: "Rent: £25 more" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON + 25 - (REGIONAL_RENT.LONDON % 25));
    choose("Region", "Wales");
    expect(box("Rent")).not.toHaveValue(REGIONAL_RENT.WALES);
    fireEvent.click(screen.getByRole("button", { name: "Use the regional average" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.WALES);

    fireEvent.click(screen.getByRole("button", { name: "Age: 1 more" }));
    expect(box("Age")).toHaveValue(31);
    fireEvent.change(box("Salary in 2026"), { target: { value: "52000" } });
    expect(box("Salary in 2026")).toHaveValue(52000);
  });

  it("asks rent only of renters, and the partner's answers only with a partner", () => {
    render(<HouseholdCalculator />);
    choose("Housing", "Own outright");
    expect(screen.queryByRole("spinbutton", { name: "Rent" })).not.toBeInTheDocument();

    expect(screen.queryByRole("spinbutton", { name: "Partner's salary in 2026" })).not.toBeInTheDocument();
    choose("Do you live with a partner?", "Yes");
    expect(box("Partner's age")).toHaveValue(30);
    expect(box("Partner's salary in 2026")).toHaveValue(DEFAULT_SALARY);
  });

  it("asks one age per child, and childcare only with children", () => {
    render(<HouseholdCalculator />);
    choose("Number of children", "2");
    expect(box("Child 1's age")).toHaveValue(5);
    fireEvent.change(box("Child 2's age"), { target: { value: "9" } });
    expect(box("Child 2's age")).toHaveValue(9);
    choose("Number of children", "3");
    expect(box("Child 2's age")).toHaveValue(9);
    expect(box("Child 3's age")).toHaveValue(5);
    moreDetails();
    expect(box("Paid childcare")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    choose("Number of children", "0");
    expect(screen.queryByRole("spinbutton", { name: "Child 1's age" })).not.toBeInTheDocument();
    moreDetails();
    expect(screen.queryByRole("spinbutton", { name: "Paid childcare" })).not.toBeInTheDocument();
  });

  it("asks the loan plan, never the balance", () => {
    // policyengine-uk's repayment depends on the plan and income; a
    // balance only caps one year's repayment
    render(<HouseholdCalculator />);
    const plans = within(group("Student loan plan"))
      .getAllByRole("radio")
      .map((radio) => radio.closest("label").querySelector(".choice-tile-label").textContent);
    expect(plans).toEqual(["No loan", "Plan 1", "Plan 2", "Plan 4", "Plan 5", "Postgraduate"]);
    choose("Student loan plan", /^Plan 2/);
    moreDetails();
    expect(screen.queryByRole("spinbutton", { name: "Student loan balance" })).not.toBeInTheDocument();
  });

  it("asks for the State Pension only at State Pension age, prefilled with the full rate", () => {
    render(<HouseholdCalculator year={2029} />);
    moreDetails();
    expect(screen.queryByRole("spinbutton", { name: "Your State Pension" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(box("Age"), { target: { value: "72" } });
    moreDetails();
    expect(box("Your State Pension")).toHaveValue(13697);
    expect(screen.getByText(/Prefilled with the full new State Pension for 2029-30 \(£13,697\)/)).toBeInTheDocument();
    fireEvent.change(box("Your State Pension"), { target: { value: "9000" } });
    expect(box("Your State Pension")).toHaveValue(9000);
  });

  it("fills the form from a young-person example, still editable", () => {
    render(<HouseholdCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "A 22-year-old renting" }));
    expect(screen.getByRole("button", { name: "A 22-year-old renting" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Rents privately at £900 a month, an illustrative figure\./)).toBeInTheDocument();
    expect(box("Age")).toHaveValue(22);
    expect(box("Salary in 2026")).toHaveValue(25000);

    fireEvent.change(box("Salary in 2026"), { target: { value: "26000" } });
    expect(box("Salary in 2026")).toHaveValue(26000);
    // Edited: no longer the example as given
    expect(screen.queryByText(/Rents privately at £900 a month/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "A 23-year-old graduate" }));
    expect(screen.getByText(/with a Plan 2 student loan/)).toBeInTheDocument();
  });

  it("fills the household answers from each example", () => {
    const cases = [
      ["A 22-year-old renting", { plan: "No loan", rent: 900 }],
      ["A 19-year-old apprentice", { plan: "No loan", rent: 600 }],
      ["A 23-year-old graduate", { plan: /^Plan 2/, rent: 900 }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = render(<HouseholdCalculator />);
      // Start from answers the example must overwrite
      choose("Do you live with a partner?", "Yes");
      choose("Number of children", "2");
      choose("Housing", "Own outright");
      fireEvent.click(screen.getByRole("button", { name: label }));

      expect(within(group("Region")).getByRole("radio", { name: "North West" })).toBeChecked();
      expect(within(group("Student loan plan")).getByRole("radio", { name: expected.plan })).toBeChecked();
      expect(within(group("Housing")).getByRole("radio", { name: "Rent privately" })).toBeChecked();
      expect(box("Rent")).toHaveValue(expected.rent);
      expect(within(group("Do you live with a partner?")).getByRole("radio", { name: "No" })).toBeChecked();
      expect(within(group("Number of children")).getByRole("radio", { name: "0" })).toBeChecked();
      unmount();
    }
  });
});

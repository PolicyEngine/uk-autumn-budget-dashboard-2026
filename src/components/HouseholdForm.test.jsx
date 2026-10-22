import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HouseholdForm from "./HouseholdForm";

function renderForm(selectedPolicies = ["threshold_freeze_extension"]) {
  const onSubmit = vi.fn();
  render(<HouseholdForm selectedPolicies={selectedPolicies} onSubmit={onSubmit} />);
  return onSubmit;
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
const change = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const DEFAULTS = {
  age: 40,
  employment_income: 35000,
  has_partner: false,
  partner_age: 40,
  partner_employment_income: 0,
  children_ages: [],
  region: "LONDON",
  claims_universal_credit: false,
  tenure: "OWNED_WITH_MORTGAGE",
  monthly_rent: 0,
  dividend_income: 0,
  savings_interest_income: 0,
  property_income: 0,
  petrol_spending: 0,
  diesel_spending: 0,
  salary_sacrifice_pension_contributions: 0,
};

describe("the household form", () => {
  it("asks the basic questions, with defaults", () => {
    renderForm();
    expect(screen.getByLabelText("Your age")).toHaveValue(40);
    expect(screen.getByLabelText("Your employment income (£ a year)")).toHaveValue(35000);
    expect(screen.getByLabelText("Children's ages")).toHaveValue("");
    expect(screen.getByLabelText("Region")).toHaveValue("LONDON");
    expect(screen.getByLabelText("Housing")).toHaveValue("OWNED_WITH_MORTGAGE");
    expect(screen.getByRole("checkbox", { name: "I live with a partner" })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "My household claims Universal Credit" }),
    ).not.toBeChecked();
  });

  it("offers the twelve UK regions", () => {
    renderForm();
    expect(screen.getByLabelText("Region").querySelectorAll("option")).toHaveLength(12);
  });

  it("submits the household in the shape the app takes", () => {
    const onSubmit = renderForm();
    change("Children's ages", "3, 7");
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ ...DEFAULTS, children_ages: [3, 7] });
  });

  it("asks about a partner only for a couple", () => {
    const onSubmit = renderForm();
    expect(screen.queryByLabelText("Partner's age")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "I live with a partner" }));
    change("Partner's age", "38");
    change("Partner's employment income (£ a year)", "22000");
    submit();
    expect(onSubmit).toHaveBeenCalledWith({
      ...DEFAULTS,
      has_partner: true,
      partner_age: 38,
      partner_employment_income: 22000,
    });
  });

  it("asks for rent only when renting", () => {
    const onSubmit = renderForm();
    expect(screen.queryByLabelText("Monthly rent (£)")).toBeNull();
    change("Housing", "RENT_PRIVATELY");
    change("Monthly rent (£)", "900");
    submit();
    expect(onSubmit).toHaveBeenCalledWith({
      ...DEFAULTS,
      tenure: "RENT_PRIVATELY",
      monthly_rent: 900,
    });
  });

  it("asks only for the income and spending the selected measures act through", () => {
    renderForm(["dividend_tax_increase_2pp", "fuel_duty_freeze"]);
    expect(
      screen.getByRole("group", { name: "More about your income and spending" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Dividends (£ a year)")).toBeInTheDocument();
    expect(screen.getByLabelText("Petrol (£ a year)")).toBeInTheDocument();
    expect(screen.getByLabelText("Diesel (£ a year)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Savings interest (£ a year)")).toBeNull();
  });

  it("asks nothing more for measures that act on every household", () => {
    renderForm(["threshold_freeze_extension", "two_child_limit"]);
    expect(
      screen.queryByRole("group", { name: "More about your income and spending" }),
    ).toBeNull();
  });

  it("submits the extra answers it asked for", () => {
    const onSubmit = renderForm(["dividend_tax_increase_2pp"]);
    change("Dividends (£ a year)", "5000");
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ ...DEFAULTS, dividend_income: 5000 });
  });

  it.each([
    ["Your age", "12", "Enter an age from 16 to 100"],
    ["Your employment income (£ a year)", "-5", "Enter an amount of £0 or more"],
    ["Children's ages", "3, 25", "Enter children's ages from 0 to 19, separated by commas"],
    ["Children's ages", "three", "Enter children's ages from 0 to 19, separated by commas"],
  ])("blocks %s of %s, saying why", (label, value, message) => {
    const onSubmit = renderForm();
    change(label, value);
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });
});

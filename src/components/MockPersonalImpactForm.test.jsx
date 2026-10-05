import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MockPersonalImpactForm from "./MockPersonalImpactForm";

it("submits the energy bill, self-employment profits, fuel litres and 2026 home value", () => {
  const submit = vi.fn();
  render(<MockPersonalImpactForm onSubmit={submit} isLoading={false} />);
  fireEvent.change(screen.getByLabelText("Your annual self-employment profits (2025)"), { target: { value: "25000" } });
  fireEvent.change(screen.getByLabelText("Children’s ages in 2025"), { target: { value: "4, 7" } });
  fireEvent.change(screen.getByLabelText("Petrol or diesel litres per year"), { target: { value: "1100" } });
  fireEvent.change(screen.getByLabelText("Annual gas and electricity bill including 5% VAT"), { target: { value: "2100" } });
  fireEvent.change(screen.getByLabelText("Annual electricity bill including 5% VAT"), { target: { value: "1200" } });
  fireEvent.change(screen.getByLabelText("Your annual capital gains"), { target: { value: "20000" } });
  fireEvent.change(screen.getByLabelText("Home value in April 2026"), { target: { value: "1600000" } });
  fireEvent.click(screen.getByRole("button", { name: "Calculate impact" }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    self_employment_income: 25000,
    children_ages: [4, 7],
    fuel_litres: 1100,
    domestic_energy_bill: 2100,
    electricity_bill: 1200,
    capital_gains: 20000,
    home_value_2026: 1600000,
  }));
});

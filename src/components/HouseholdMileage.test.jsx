import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdCalculator, { resetSavedWizard } from "./HouseholdCalculator";
import { MILEAGE_RATES_ID, SAVINGS_INCOME_RATES_ID } from "../utils/calculatorOnlyMeasures";

// The Household calculator's business miles (#357): a number box of whole
// miles a year in step 1, at Anthony's request, and "Driven as" (employee
// or self-employed) once miles are entered. With miles, a household's
// request carries them and the household-only mileage measure.

beforeEach(() => {
  resetSavedWizard();
});

const POLICIES = [
  { id: "fuel_duty_rise_deferral", name: "Fuel duty cut extended" },
  { id: "trading_allowance_raise", name: "Trading allowance raised" },
];
const SELECTED = POLICIES.map((policy) => policy.id);

const yoursCard = () => {
  const cards = screen.getByRole("region", { name: "Choose a household" });
  return (
    within(cards).queryByRole("button", { name: /^Your household/ }) ??
    within(cards).getByRole("option", { name: /^Your household/ })
  );
};
const renderForm = (props = {}) => {
  const view = render(<HouseholdCalculator selectedPolicies={SELECTED} policies={POLICIES} {...props} />);
  fireEvent.click(yoursCard());
  return view;
};
const youStep = () => screen.getByRole("group", { name: /^Step 1: You$/ });
const milesBox = () => within(youStep()).getByRole("spinbutton", { name: "Business miles" });
const roleGroup = () => screen.queryByRole("radiogroup", { name: "Driven as" });
const typeMiles = (text) => {
  fireEvent.change(milesBox(), { target: { value: text } });
  fireEvent.blur(milesBox());
};
const milesError = () => document.getElementById("error-business_miles_per_year");

describe("business miles in the Household calculator", () => {
  it("are asked in step 1 as a box of whole miles, none at first, and Driven as only once miles are entered", () => {
    renderForm();
    const rows = [...youStep().querySelectorAll(".household-field")].map((row) => row.dataset.row);
    expect(rows).toEqual(["current_age", "current_salary", "region", "business_miles_per_year"]);
    expect(milesBox()).toHaveValue(0);
    expect(milesBox()).toHaveAttribute("min", "0");
    expect(milesBox()).toHaveAttribute("max", "100000");
    expect(roleGroup()).toBeNull();
    typeMiles("15000");
    expect(milesBox()).toHaveValue(15000);
    const role = roleGroup();
    expect(within(role).getAllByRole("radio").map((radio) => radio.closest("label").textContent)).toEqual([
      "Employee",
      "Self-employed",
    ]);
    expect(within(role).getByRole("radio", { name: "Employee" })).toBeChecked();
    typeMiles("0");
    expect(roleGroup()).toBeNull();
  });

  it("rounds a fraction to whole miles on leaving the box, and says so", () => {
    renderForm();
    fireEvent.change(milesBox(), { target: { value: "15000.6" } });
    expect(milesBox()).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(milesBox());
    expect(milesBox()).toHaveValue(15001);
    expect(milesError()).toHaveTextContent("Whole miles, from 0 to 100,000 a year. 15,000.6 was changed to 15,001.");
  });

  it("takes an empty box as no business miles, and keeps to 100,000", () => {
    renderForm();
    typeMiles("15000");
    typeMiles("");
    expect(milesBox()).toHaveValue(0);
    expect(roleGroup()).toBeNull();
    typeMiles("250000");
    expect(milesBox()).toHaveValue(100000);
    expect(milesError()).toHaveTextContent("250,000 was changed to 100,000.");
  });

  it("sends the miles, the role and the mileage measure with Calculate, and leaves the examples' requests alone", async () => {
    const API = "https://api.test/api/household-impact";
    const bodies = [];
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", API);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (url === API) bodies.push(JSON.parse(init.body));
        return new Response("{}", { status: 404 });
      }),
    );
    try {
      renderForm({ year: 2027 });
      typeMiles("15000");
      fireEvent.click(within(roleGroup()).getByRole("radio", { name: "Self-employed" }));
      fireEvent.click(screen.getByRole("button", { name: /^Calculate/ }));
      const headline = () => bodies.filter((body) => body.household.business_miles === 15000 && body.include.length === 0);
      await waitFor(() => expect(headline()).toHaveLength(1));
      expect(headline()[0].household.business_miles_role).toBe("SELF_EMPLOYED");
      expect(headline()[0].policies).toEqual([...SELECTED, SAVINGS_INCOME_RATES_ID, MILEAGE_RATES_ID]);
      // The example cards' figures: no miles, so neither the miles nor the measure
      const cards = bodies.filter((body) => body.household.business_miles === undefined);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.some((body) => body.policies.includes(MILEAGE_RATES_ID))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

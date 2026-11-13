import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { policyVisual } from "./PolicyVisual";
import { PolicyCard } from "../PolicyCards";
import { POLICY_DETAILS } from "../../utils/policyDetails";

const document = JSON.parse(readFileSync(join(process.cwd(), "public/data/policy_parameters.json"), "utf8"));
const details = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));
// A published measure as the card gets it: the card details, the published name and description
const policy = (id) => ({ ...details[id], id, label: details[id].name, description: details[id].writtenFor, direction: "cost" });
const show = (id) => render(policyVisual(policy(id), document.measures[id]));
const image = () => screen.getAllByRole("img")[0];

describe("PolicyVisual", () => {
  it.each(["fuel_duty_rise_deferral", "carers_allowance_earnings_taper", "domestic_electricity_zero_vat", "trading_allowance_raise", "bus_fare_cap_2027"])("defers %s to its native policy table without an old special example", (id) => {
    expect(policyVisual(policy(id), document.measures[id])).toBeNull();
  });


  it("Household Energy Payment: bands A to D of eight, and the reach as bars", () => {
    const { container } = show("household_energy_payment_2026");
    expect(image()).toHaveAccessibleName(/£100 once to households in council tax bands A to D, 4 of England's 8/);
    expect(container.querySelectorAll(".pviz-band.is-paid")).toHaveLength(4);
    expect(container.querySelectorAll(".pviz-band")).toHaveLength(8);
    expect(container).toHaveTextContent("up to 20 million of about 25 million");
    for (const share of ["80%", "83%", "88%"]) expect(container).toHaveTextContent(share);
  });



  it("property income tax: the rate ladder, 22/42/47 to 24/44/49", () => {
    const { container } = show("property_income_rates_up");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /from 6 April 2027, in England, Wales and Northern Ireland: basic rate 22% to 24%, higher rate 42% to 44%, additional rate 47% to 49%/,
    );
    expect(container.querySelectorAll(".pviz-rung")).toHaveLength(3);
    expect(container).toHaveTextContent("not Scotland");
  });

  it("Pension Tax Allowance: £94 to £13,036, tapering to about £13,319, with the explainer's examples", () => {
    const { container } = show("state_pension_income_tax_protection");
    expect(image()).toHaveAccessibleName(/£94 up to the full new State Pension \(£13,036\).*gone at about £13,319.*At £13,186: £44/);
    expect(container.querySelectorAll(".pviz-dot")).toHaveLength(2);
    expect(container).toHaveTextContent("£13,186: £44");
  });


  it("draws nothing without the measure's entry, or for a measure without a visual", () => {
    expect(policyVisual(policy("trading_allowance_raise"), null)).toBeNull();
    expect(policyVisual({ id: "x", name: "X" }, document.measures.trading_allowance_raise)).toBeNull();
  });
});

describe("the visual on its card", () => {
  const card = (id) => render(<PolicyCard policy={policy(id)} parameters={document.measures[id]} />);

  it("keeps the native PTA visual in place of the generic plot", () => {
    const { container } = card("state_pension_income_tax_protection");
    const change = screen.getByRole("region", { name: /What changes/ });
    expect(within(change).getByRole("img", { name: /Pension Tax Allowance/ })).toBeInTheDocument();
    expect(container.querySelector(".pchg-svg")).toBeNull();
  });

  it("draws the example's figures in place of its words, keeping its source", () => {
    const { container } = card("household_energy_payment_2026");
    const example = screen.getByRole("region", { name: /Who it reaches/ });
    expect(within(example).getByRole("img")).toBeInTheDocument();
    expect(container.querySelector(".policy-card-example-items")).toBeNull();
    expect(within(example).getByRole("link", { name: /Budget 2026, paragraphs 3.5 and 3.6/ })).toBeInTheDocument();
  });

  it("folds the Pension Tax Allowance's example into the chart, said once", () => {
    const { container } = card("state_pension_income_tax_protection");
    expect(container.querySelector(".policy-card-example")).toBeNull();
    expect(container).toHaveTextContent("£13,186: £44");
  });

  it("falls back to the card as before when the file's entry is for another description", () => {
    const id = "household_energy_payment_2026";
    render(<PolicyCard policy={policy(id)} parameters={null} />);
    expect(screen.getByText("88% of households in the bottom three income deciles")).toBeInTheDocument();
  });
});

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
  it("fuel duty: the cut's months and the duty saved on a 50-litre fill", () => {
    const { container } = show("fuel_duty_rise_deferral");
    expect(image()).toHaveAccessibleName(/Jan to Feb 2027: 52\.95p instead of 55\.95p, £1\.50 less duty on a 50-litre fill/);
    expect(container).toHaveTextContent("Duty saved on a 50-litre fill");
    expect(container).toHaveTextContent("£1.50");
    expect(container).toHaveTextContent("£2.50");
    expect(container).toHaveTextContent("£3.82");
    expect(container).toHaveTextContent("−7.64p");
  });

  it("Carer's Allowance: the cliff edge in the loss colour and the taper", () => {
    const { container } = show("carers_allowance_earnings_taper");
    expect(image()).toHaveAccessibleName(/£96\.44 a week up to the earnings limit of £228.*runs out at £324 a week/);
    expect(container.querySelector(".pviz-cliff")).not.toBeNull();
    expect(container).toHaveTextContent("Cliff edge");
    expect(container).toHaveTextContent("£1 for £1");
    // No caption: the card's points say it in words (PR 359)
    expect(container.querySelector(".pchg-note, figcaption")).toBeNull();
  });

  it("Household Energy Payment: bands A to D of eight, and the reach as bars", () => {
    const { container } = show("household_energy_payment_2026");
    expect(image()).toHaveAccessibleName(/£100 once to households in council tax bands A to D, 4 of England's 8/);
    expect(container.querySelectorAll(".pviz-band.is-paid")).toHaveLength(4);
    expect(container.querySelectorAll(".pviz-band")).toHaveLength(8);
    expect(container).toHaveTextContent("up to 20 million of about 25 million");
    for (const share of ["80%", "83%", "88%"]) expect(container).toHaveTextContent(share);
  });

  it("trading allowance: the band from £1,000 to £3,000 and the example's £400", () => {
    const { container } = show("trading_allowance_raise");
    expect(image()).toHaveAccessibleName(/from £1,000 to £3,000.*pays £400 less income tax/);
    expect(container).toHaveTextContent("£2,000 more tax-free");
    expect(container.querySelector(".pviz-band-saving-value")).toHaveTextContent("£400");
  });

  it("zero VAT on electricity: a month strip for Great Britain and Northern Ireland", () => {
    const { container } = show("domestic_electricity_zero_vat");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /Great Britain: 0% from October 2026 to June 2027; Northern Ireland: 0% from April 2027 to June 2027 \(expected\)\. October 2026 to March 2027 was already law/,
    );
    expect(container.querySelectorAll(".pviz-cal-cell.is-zero")).toHaveLength(9);
    expect(container.querySelectorAll(".pviz-cal-cell.is-expected")).toHaveLength(3);
    expect(container).toHaveTextContent("Law before the Budget");
  });

  it("property income tax: the rate ladder, 22/42/47 to 24/44/49", () => {
    const { container } = show("property_income_rates_up");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /from 2027-28, in England, Wales and Northern Ireland: basic rate 22% to 24%, higher rate 42% to 44%, additional rate 47% to 49%/,
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

  it("bus fare cap: £3 then £2 as columns, and the example's £13 and £40", () => {
    const { container } = show("bus_fare_cap_2027");
    expect(image()).toHaveAccessibleName(/capped at £2 instead of £3.*10% of bus fare spending.*£13 in 2026-27 and £40 in 2027-28/);
    expect([...container.querySelectorAll(".pviz-bus-value")].map((v) => v.textContent)).toEqual(["£3", "£2"]);
    expect([...container.querySelectorAll(".pviz-band-saving-value")].map((v) => v.textContent)).toEqual(["£13", "£40"]);
  });

  it("draws nothing without the measure's entry, or for a measure without a visual", () => {
    expect(policyVisual(policy("trading_allowance_raise"), null)).toBeNull();
    expect(policyVisual({ id: "x", name: "X" }, document.measures.trading_allowance_raise)).toBeNull();
  });
});

describe("the visual on its card", () => {
  const card = (id) => render(<PolicyCard policy={policy(id)} parameters={document.measures[id]} />);

  it("takes the plot's and the note's place in What changes", () => {
    const { container } = card("carers_allowance_earnings_taper");
    const change = screen.getByRole("region", { name: /What changes/ });
    expect(within(change).getByRole("img", { name: /Carer's Allowance against weekly earnings/ })).toBeInTheDocument();
    expect(container.querySelector(".pchg-svg")).toBeNull();
    expect(container.querySelector(".pchg-note")).toBeNull();
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

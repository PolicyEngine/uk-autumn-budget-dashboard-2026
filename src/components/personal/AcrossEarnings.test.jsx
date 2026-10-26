import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { AcrossEarnings } from "./SingleYearResults";
import { normaliseHouseholdImpact } from "../../utils/householdImpactApi";

// A real answer with both cards' parts: the higher earner's, 2027-28
const file = JSON.parse(readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "public", "data", "household_presets.json"), "utf8"));
const answer = (id, year = 2027) =>
  normaliseHouseholdImpact(file.entries.find((entry) => entry.preset_id === id && entry.year === year).response);

const cards = (container) => container.querySelectorAll(".single-year-chart-pair > .single-year-card");
const chipLabels = (card) => [...card.querySelectorAll(".series-toggle-chip")].map((chip) => chip.textContent).slice(0, -1);

describe("the two Across earnings cards", () => {
  it("list the same components in the same order, and a chip toggled on one toggles the other", () => {
    const data = answer("higher-earner");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    // Each key: the components that apply, in the shared order
    const order = (labels) => labels.filter((label) => !/with no effect/.test(label));
    expect(order(chipLabels(net))).toContain("Income tax");
    expect(order(chipLabels(rate))).toContain("Personal allowance taper");
    const netTax = within(net).getByRole("button", { name: "Income tax" });
    expect(within(rate).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(netTax);
    expect(within(rate).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "false");
    // Those with nothing here fold into one chip, opened on both cards at once
    expect(within(net).queryByRole("button", { name: "Personal allowance taper" })).toBeNull();
    fireEvent.click(within(net).getByRole("button", { name: /^\+\d+ with no effect for you$/ }));
    expect(within(rate).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
    // The personal allowance taper is inside income tax on the net income card
    expect(within(net).getByRole("button", { name: "Personal allowance taper" })).toHaveAttribute("aria-disabled", "true");
    // One view for both
    fireEvent.click(within(rate).getByRole("button", { name: "Change" }));
    expect(within(net).getByRole("button", { name: "Change" })).toHaveAttribute("aria-pressed", "true");
  });

  it("say 'With no earnings' for the pensioner, with the You marker at £0 and the allowance caveat", () => {
    const data = answer("pensioner-70");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    expect(net.querySelector(".chart-description").textContent).toMatch(/^With no earnings, your household's net income is about £[\d,]+ a year after the selected policies\.$/);
    expect(rate.querySelector(".chart-description").textContent).toMatch(/^With no earnings, your marginal tax rate on your first £200 would be 20% before and 39% after/);
    expect(net.querySelector(".earnings-you")).not.toBeNull();
    fireEvent.click(within(rate).getByRole("button", { name: "About this chart" }));
    expect(rate.querySelector(".chart-more-info")).toHaveTextContent(/withdrawn £1 for every £1 of other income/);
  });
});

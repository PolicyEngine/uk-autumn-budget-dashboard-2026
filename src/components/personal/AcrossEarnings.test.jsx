import { readFileSync } from "node:fs";
import { chooseOption, optionsLabel } from "../../test/optionsPills";
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
// Each card's chips but its own total line (Net income after, Total rate after)
const chipLabels = (card) =>
  [...card.querySelectorAll(".series-toggle-chip")].map((chip) => chip.textContent).filter((label) => !/^(Net income|Total rate|Change in)/.test(label));

describe("the two Across earnings cards", () => {
  it("list the same components in the same order, and a chip toggled on one toggles the other", () => {
    const data = answer("higher-earner");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    // Both keys alike, chip for chip: what applies on either card, then the
    // same "+N with no effect for you"
    expect(chipLabels(net)).toEqual(chipLabels(rate));
    expect(chipLabels(net)).toContain("Personal allowance taper");
    expect(chipLabels(net)).toContain("Council Tax");
    // Where a shown component has nothing on this card: disabled, with why
    expect(within(rate).getByRole("button", { name: "Council Tax" })).toHaveAttribute("aria-disabled", "true");
    const netTax = within(net).getByRole("button", { name: "Income tax" });
    expect(within(rate).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(netTax);
    expect(within(rate).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "false");
    // Those that apply on neither fold into one chip, opened on both at once
    fireEvent.click(within(net).getByRole("button", { name: /^\+\d+ with no effect for you$/ }));
    expect(within(rate).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
    // The personal allowance taper is inside income tax on the net income card
    expect(within(net).getByRole("button", { name: "Personal allowance taper" })).toHaveAttribute("aria-disabled", "true");
    // One view for both
    chooseOption(rate, "Change");
    expect(optionsLabel(net)).toBe("Change");
  });

  it("say 'With no earnings' for the pensioner, with the You marker at £0 and the allowance caveat", () => {
    const data = answer("pensioner-70");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    expect(net.querySelector(".chart-description").textContent).toMatch(/^With no earnings, your household's net income is about £[\d,]+ a year after the selected policies\.$/);
    expect(rate.querySelector(".chart-description").textContent).toMatch(/^With no earnings, your marginal tax rate on your first £200 would be 16% before and 32% after/);
    expect(net.querySelector(".earnings-you")).not.toBeNull();
    fireEvent.click(within(rate).getByRole("button", { name: "About this chart" }));
    expect(rate.querySelector(".chart-more-info")).toHaveTextContent(/withdrawn £1 for every £1 of other income/);
  });
});

describe("tenths in plain words", () => {
  it("names the lowest and highest, and the rest in words", async () => {
    const { tenthName } = await import("./IncomePositionChart");
    expect(tenthName(1)).toBe("Lowest tenth");
    expect(tenthName(3)).toBe("Third tenth");
    expect(tenthName(10)).toBe("Highest tenth");
  });
});

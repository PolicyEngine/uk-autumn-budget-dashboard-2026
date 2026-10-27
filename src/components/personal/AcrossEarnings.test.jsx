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
const shownChips = (container) =>
  [...container.querySelectorAll(".across-earnings-show .series-toggle-chip:not(.series-toggle-more)")].map((chip) => chip.textContent);

describe("the two Across earnings cards", () => {
  it("share one Show control above both, which switches a component on both cards", () => {
    const data = answer("higher-earner");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    // No Show chips on either card: one control above the pair
    expect(net.querySelector(".series-toggle-chip")).toBeNull();
    expect(rate.querySelector(".series-toggle-chip")).toBeNull();
    const show = container.querySelector(".across-earnings-show");
    expect(show).toHaveTextContent(/^Show on both charts/);
    // Boxed as the section measure key: a titled bar above the pair
    expect(show.querySelector(".series-toggle-wrap.is-section > .series-toggle-title")).toHaveTextContent("Show on both charts");
    // What applies on either card, once each, then the total
    const chips = shownChips(container);
    expect(chips).toContain("Personal allowance taper");
    expect(chips).toContain("Council Tax");
    expect(chips).toContain("Income tax");
    expect(chips[chips.length - 1]).toBe("Total");
    expect(new Set(chips).size).toBe(chips.length);
    const tax = within(show).getByRole("button", { name: "Income tax" });
    expect(tax).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tax);
    expect(within(show).getByRole("button", { name: "Income tax" })).toHaveAttribute("aria-pressed", "false");
    // Those that apply on neither fold into one text toggle
    fireEvent.click(within(show).getByRole("button", { name: /^\d+ more with no effect for you$/ }));
    expect(within(show).getByRole("button", { name: /^Hide the \d+ with no effect$/ })).toHaveAttribute("aria-expanded", "true");
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
    expect(rate.querySelector(".chart-more-info")).toHaveTextContent(/Any earnings take the whole allowance away/);
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

describe("one rounding for the change", () => {
  it("gives the result tile and the example card the same whole pounds, for every example and year", async () => {
    const { headlineTotals } = await import("./SingleYearResults");
    const { signedMoney } = await import("./HouseholdCards");
    // The higher earner, 2027-28: £108.38 is +£108 (not 70,159 − 70,050)
    expect(headlineTotals({ before: 70050.44, after: 70158.81, change: 108.38 })).toEqual({ before: 70050, after: 70158, change: 108 });
    for (const entry of file.entries) {
      const data = normaliseHouseholdImpact(entry.response);
      expect(signedMoney(headlineTotals(data.net).change), `${entry.preset_id} ${entry.year}`).toBe(signedMoney(data.net.change));
    }
  });
});

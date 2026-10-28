import { readFileSync } from "node:fs";
import { chooseOption, optionsLabel } from "../../test/optionsPills";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { AcrossEarnings } from "./SingleYearResults";
import { normaliseHouseholdImpact } from "../../utils/householdImpactApi";

// A real answer with both cards' parts: the middle earner who lets a flat, 2027-28
const file = JSON.parse(readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "public", "data", "household_presets.json"), "utf8"));
const answer = (id, year = 2027) =>
  normaliseHouseholdImpact(file.entries.find((entry) => entry.preset_id === id && entry.year === year).response);

const cards = (container) => container.querySelectorAll(".single-year-chart-pair > .single-year-card");
const chipsOf = (card) =>
  [...card.querySelectorAll(".single-year-legend .series-toggle-chip:not(.series-toggle-more)")].map((chip) => chip.textContent);
const pressed = (card, name) => within(card).getByRole("button", { name }).getAttribute("aria-pressed");

describe("the two Across earnings cards", () => {
  it("each draw the same Show chips under their plot, one state for both", () => {
    const data = answer("landlord-45k");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    // No box above the pair: each card's key is in its own legend row
    expect(container.querySelector(".across-earnings-show")).toBeNull();
    expect(container.querySelector(".series-toggle-wrap.is-section")).toBeNull();
    expect(container).not.toHaveTextContent("Show on both charts");
    for (const card of [net, rate]) {
      const legend = card.querySelector(".single-year-legend");
      // Under the plot, before the logo and About this chart
      expect(legend.querySelector(".series-toggle-lead")).toHaveTextContent("Show:");
      expect(legend.compareDocumentPosition(card.querySelector(".chart-footer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // What applies on either card, once each, then the total; the same on both
    const chips = chipsOf(net);
    expect(chipsOf(rate)).toEqual(chips);
    expect(chips).toContain("Personal allowance taper");
    expect(chips).toContain("Council Tax");
    expect(chips).toContain("Income tax");
    expect(chips[chips.length - 1]).toBe("Total");
    expect(new Set(chips).size).toBe(chips.length);
    // A chip on one card switches it on both keys
    expect(pressed(net, "Income tax")).toBe("true");
    expect(pressed(rate, "Income tax")).toBe("true");
    fireEvent.click(within(net).getByRole("button", { name: "Income tax" }));
    expect(pressed(net, "Income tax")).toBe("false");
    expect(pressed(rate, "Income tax")).toBe("false");
    fireEvent.click(within(rate).getByRole("button", { name: "Income tax" }));
    expect(pressed(net, "Income tax")).toBe("true");
    expect(pressed(rate, "Income tax")).toBe("true");
    // Those that apply on neither fold into one text toggle on each, opened together
    fireEvent.click(within(rate).getByRole("button", { name: /^\d+ more with no effect for you$/ }));
    for (const card of [net, rate]) {
      expect(within(card).getByRole("button", { name: /^Hide the \d+ with no effect$/ })).toHaveAttribute("aria-expanded", "true");
    }
    expect(chipsOf(rate)).toEqual(chipsOf(net));
    // Hovering a chip says what it is, and on which chart it has no effect
    fireEvent.mouseEnter(within(net).getByRole("button", { name: "Council Tax" }));
    expect(document.querySelector(".tip[role='tooltip']")).toHaveTextContent(
      /^Council Tax: no effect on your marginal tax rate — shown on Household net income only\. The local tax on your home/,
    );
    fireEvent.mouseLeave(within(net).getByRole("button", { name: "Council Tax" }));
    fireEvent.mouseEnter(within(rate).getByRole("button", { name: "National Insurance" }));
    expect(document.querySelector(".tip[role='tooltip']")).toHaveTextContent("Employee National Insurance on earnings.");
    fireEvent.mouseLeave(within(rate).getByRole("button", { name: "National Insurance" }));
    // One view for both
    chooseOption(rate, "Change");
    expect(optionsLabel(net)).toBe("Change");
  });

  it("drop the 'Click to show or hide' hint from both keys at the first click", () => {
    window.sessionStorage.removeItem("pe-series-toggle-hint-seen");
    const data = answer("landlord-45k");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    expect(net.querySelector(".series-toggle-hint")).toHaveTextContent("Click to show or hide");
    expect(rate.querySelector(".series-toggle-hint")).toHaveTextContent("Click to show or hide");
    fireEvent.click(within(rate).getByRole("button", { name: "Income tax" }));
    expect(net.querySelector(".series-toggle-hint")).toBeNull();
    expect(rate.querySelector(".series-toggle-hint")).toBeNull();
    window.sessionStorage.removeItem("pe-series-toggle-hint-seen");
  });

  it("say so when the answer has no breakdown by tax and benefit, rather than silently drawing one line", () => {
    const data = answer("landlord-45k");
    const bare = { ...data.sweep, netParts: null, parts: null };
    const { container } = render(<AcrossEarnings sweep={bare} salary={data.salaryUsed} yearLabel="2027-28" />);
    expect(container.querySelector(".across-earnings-no-parts")).toHaveTextContent(
      "The calculation server did not send the breakdown of net income or the marginal tax rate by tax and benefit, so both charts show the total only.",
    );
    // With the parts, no note
    const full = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    expect(full.container.querySelector(".across-earnings-no-parts")).toBeNull();
  });

  it("say 'With no earnings' for the pensioner, with the You marker at £0 and no State-Pension-only caveat", () => {
    // £12,800 of pensions: the first £200 of earnings keeps the total
    // income under the full new State Pension, so still protected
    const data = answer("pensioner-70");
    const { container } = render(<AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel="2027-28" />);
    const [net, rate] = cards(container);
    expect(net.querySelector(".chart-description").textContent).toMatch(/^With no earnings, your household's net income is about £[\d,]+ a year with the selected policies\.$/);
    expect(rate.querySelector(".chart-description").textContent).toMatch(/^On your first £200 of earnings, your marginal tax rate falls from 20% to 0%, so you keep £200 instead of £\d+\.$/);
    expect(net.querySelector(".earnings-you")).not.toBeNull();
    fireEvent.click(within(rate).getByRole("button", { name: "About this chart" }));
    // The allowance caveat flags a rate that rises at the start of earnings
    // with the policies; here they lower it there (20% to 0%), so none
    expect(rate.querySelector(".chart-more-info")).not.toHaveTextContent(/at or below the full new State Pension/);
    expect(rate.querySelector(".chart-more-info")).not.toHaveTextContent(/usual personal allowance applies again/);
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

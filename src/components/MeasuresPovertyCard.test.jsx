import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import { measurePovertyRows } from "./MeasuresPovertyCard";
import { POLICIES } from "../utils/policies";

const PUBLIC = join(__dirname, "..", "..", "public");

beforeEach(() => {
  // The published files, as the page reads them
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = join(PUBLIC, new URL(String(url), "http://localhost").pathname);
      return existsSync(path) ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("measurePovertyRows", () => {
  const ALL = POLICIES.map((policy) => policy.id);
  const row = (reform_id, value, affected = 1) => ({
    reform_id,
    year: "2027",
    people_affected: String(affected),
    poverty_change_pp: String(value),
  });

  it("sorts the measures by size, leaves out £0 ones and puts the package last", () => {
    const rows = [
      row("autumn_budget_2026_combined", -0.008),
      row("state_pension_income_tax_protection", -0.002),
      row("plan_2_threshold_unfreeze", -0.005),
      row("fuel_duty_rise_deferral", 0),
      row("employer_ni_relief_under_25s", 0, 0),
    ];
    const { members, bars } = measurePovertyRows(rows, POLICIES, ALL, 2027, "poverty_change_pp");
    expect(bars.map((bar) => [bar.id, bar.value])).toEqual([
      ["plan_2_threshold_unfreeze", -0.005],
      ["state_pension_income_tax_protection", -0.002],
      ["fuel_duty_rise_deferral", 0],
      ["autumn_budget_2026_combined", -0.008],
    ]);
    expect(bars.at(-1).isPackage).toBe(true);
    // Employer NI changes no household's income: in More info, not a bar
    expect(members.find((member) => member.id === "employer_ni_relief_under_25s").muted).toBe(true);
  });

  it("has no package row for a selection with no single run", () => {
    const rows = [row("plan_2_threshold_unfreeze", -0.005), row("fuel_duty_rise_deferral", 0)];
    const { bars } = measurePovertyRows(
      rows,
      POLICIES,
      ["plan_2_threshold_unfreeze", "fuel_duty_rise_deferral"],
      2027,
      "poverty_change_pp",
    );
    expect(bars.some((bar) => bar.isPackage)).toBe(false);
  });
});

describe("the Poverty sub-tab", () => {
  it("is four cards, two a row: the measures' effect, then current law", async () => {
    window.history.replaceState({}, "", "/?sub=poverty");
    render(<App />);
    const panel = await screen.findByRole("tabpanel", { name: "Poverty" });
    const card = async (name) =>
      (await within(panel).findByRole("heading", { level: 3, name }, { timeout: 5000 })).closest(".charts-grid > div");
    const change = await card(/^Change in the poverty rate$/);
    const measures = await card(/^Which measures move poverty/);
    const overTime = await card(/^Poverty over time$/);
    const who = await card(/^Who is in poverty$/);
    expect(change.parentElement).toBe(measures.parentElement);
    expect(overTime.parentElement).toBe(who.parentElement);
    expect(change.parentElement).not.toBe(overTime.parentElement);

    // Every card chooses at the top, with dropdowns
    for (const c of [change, measures]) {
      expect(within(c).getByRole("button", { name: /^Poverty line:/ })).toBeInTheDocument();
    }
    // The change in people, from the outlook's population
    expect(change.querySelector(".chart-description")).toHaveTextContent(/2027-28: −0\.008pp \(≈[\d,]+ fewer people\)/);
    // One bar per measure that changes incomes, the package last
    const rows = within(measures).getAllByRole("rowheader").map((r) => r.textContent);
    expect(rows.at(-1)).toBe("All selected measures");
    expect(rows).not.toContain("Employer NI relief for under-25s");

    // One poverty choice for both cards
    fireEvent.click(within(measures).getByRole("button", { name: /^Poverty line:/ }));
    fireEvent.click(within(measures).getByRole("option", { name: "Relative" }));
    expect(within(change).getByRole("button", { name: /^Poverty line:/ })).toHaveTextContent("Relative");
    expect(new URLSearchParams(window.location.search).get("poverty")).toBe("relative-bhc-all");

    // More info: the £0 measures and that the parts need not add up
    fireEvent.click(within(measures).getByRole("button", { name: "More info" }));
    expect(within(measures).getByText(/need not add up exactly to the package/)).toBeInTheDocument();
    expect(within(measures).getByText(/Employer NI relief for under-25s/)).toBeInTheDocument();
  });
});

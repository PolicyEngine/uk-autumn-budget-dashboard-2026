import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import { measurePovertyRows, povertyWaterfall } from "./MeasuresPovertyCard";
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

describe("measurePovertyRows and povertyWaterfall", () => {
  const ALL = POLICIES.map((policy) => policy.id);
  const row = (reform_id, value, affected = 1) => ({
    reform_id,
    year: "2027",
    people_affected: String(affected),
    poverty_change_pp: String(value),
  });
  const rows = [
    row("autumn_budget_2026_combined", -0.008),
    row("state_pension_income_tax_protection", -0.002),
    row("plan_2_threshold_unfreeze", -0.005),
    row("fuel_duty_rise_deferral", 0),
    row("employer_ni_relief_under_25s", 0, 0),
  ];

  it("reads each measure's own change by its short name, the package from the combined run", () => {
    const { members, measures, total } = measurePovertyRows(rows, POLICIES, ALL, 2027, "poverty_change_pp");
    expect(measures.map((m) => m.name)).toContain("Plan 2 threshold unfrozen");
    expect(total).toBe(-0.008);
    // Employer NI changes no household's income: in More info, not a step
    expect(members.find((member) => member.id === "employer_ni_relief_under_25s").muted).toBe(true);
    expect(measures.some((m) => m.id === "employer_ni_relief_under_25s")).toBe(false);
  });

  it("steps by size in people out of poverty, closes the gap with an interaction step and ends at the package", () => {
    const { measures, total } = measurePovertyRows(rows, POLICIES, ALL, 2027, "poverty_change_pp");
    // 70 million people: 0.001pp is 700 people
    const { steps, zero, peopleMode } = povertyWaterfall(measures, total, 70);
    expect(peopleMode).toBe(true);
    expect(steps.map((s) => [s.kind, s.id])).toEqual([
      ["measure", "plan_2_threshold_unfreeze"],
      ["measure", "state_pension_income_tax_protection"],
      ["interaction", "interaction"],
      ["total", "autumn_budget_2026_combined"],
    ]);
    // A fall in poverty steps right; each step starts where the last ended
    expect(steps[0].x).toBeCloseTo(3500);
    expect(steps[1].start).toBeCloseTo(3500);
    expect(steps[2].x).toBeCloseTo(700);
    expect(steps[3].start).toBe(0);
    expect(steps[3].end).toBeCloseTo(5600);
    // Measures that move no one are one line, not rows
    expect(zero.map((m) => m.id)).toEqual(["fuel_duty_rise_deferral"]);
  });

  it("falls back to percentage points without a population, and has no package for a part selection", () => {
    const { measures } = measurePovertyRows(rows, POLICIES, ["plan_2_threshold_unfreeze", "fuel_duty_rise_deferral"], 2027, "poverty_change_pp");
    const { steps, peopleMode } = povertyWaterfall(measures, null, null);
    expect(peopleMode).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(["measure"]);
    expect(steps[0].x).toBeCloseTo(0.005);
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
    // A waterfall in people: short names, the package last, the measures
    // that move no one on one muted line
    const rows = within(measures).getAllByRole("rowheader").map((r) => r.textContent);
    expect(rows[0]).toBe("Plan 2 threshold unfrozen");
    expect(rows.at(-1)).toBe("Package");
    expect(rows).not.toContain("Employer NI relief, under-25s");
    expect(within(measures).getByText(/^No effect on poverty: /)).toHaveTextContent(/BADR restricted/);
    expect(measures.querySelector(".wf-total .wf-main")).toHaveTextContent(/^≈[\d,]+ fewer$/);
    expect(measures.querySelector(".chart-description")).toHaveTextContent(/Biggest: Plan 2 threshold unfrozen, ≈[\d,]+ fewer people \(−0\.005pp\)/);

    // One poverty choice for both cards
    fireEvent.click(within(measures).getByRole("button", { name: /^Poverty line:/ }));
    fireEvent.click(within(measures).getByRole("option", { name: "Relative" }));
    expect(within(change).getByRole("button", { name: /^Poverty line:/ })).toHaveTextContent("Relative");
    expect(new URLSearchParams(window.location.search).get("poverty")).toBe("relative-bhc-all");

    // More info: the £0 measures and that the parts need not add up
    fireEvent.click(within(measures).getByRole("button", { name: "More info" }));
    expect(within(measures).getByText(/need not add up to the package/)).toBeInTheDocument();
    expect(within(measures).getByText(/Employer NI relief for under-25s/)).toBeInTheDocument();
  });
});

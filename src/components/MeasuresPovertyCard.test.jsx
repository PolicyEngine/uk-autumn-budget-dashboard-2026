import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { PovertyMeasuresRow, measurePovertyRows, povertyWaterfall } from "./MeasuresPovertyCard";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";

const PUBLIC = join(__dirname, "..", "..", "public");
const published = (file) => parseDashboardCsv(readFileSync(join(PUBLIC, "data", file), "utf8"));

// A catalogue built from the flat files' own measures, as a manifest with
// every one approved and every artifact verified (test only, as in
// HouseholdChartLegends.test.jsx)
const COMBINED = "autumn_budget_2026_combined";
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const budget = published("budgetary_impact.csv");
const metrics = published("metrics.csv");
const ALL = [...new Set(budget.map((row) => row.reform_id))].filter((id) => id !== COMBINED);
const nameOf = (id) => budget.find((row) => row.reform_id === id).reform_name;
const entry = (extra) => ({ status: "approved", years: YEARS, unsupported_years: [], ...extra });
const detailsOf = (id) => POLICY_DETAILS.find((policy) => policy.id === id);
const catalogue = buildMeasureCatalogue({
  manifest: {
    measures: Object.fromEntries(ALL.map((id) => [id, entry({ name: nameOf(id), description: detailsOf(id)?.writtenFor, outputs_sha256: "a".repeat(64) })])),
    combined: { [COMBINED]: entry({ name: nameOf(COMBINED), measures: ALL, member_outputs_sha256: Object.fromEntries(ALL.map((id) => [id, "a".repeat(64)])) }) },
  },
  budgetary: budget,
  metrics,
  tablesByKey: Object.fromEntries([...ALL, COMBINED].map((id) => [id, { budgetary_impact: budget.filter((row) => row.reform_id === id) }])),
});

beforeEach(() => {
  // The outlook (for the populations), as the page reads it
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = join(PUBLIC, new URL(String(url), "http://localhost").pathname);
      return existsSync(path) ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/?sub=poverty");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("measurePovertyRows and povertyWaterfall", () => {
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
    const { members, measures, total } = measurePovertyRows(rows, catalogue, ALL, 2027, "poverty_change_pp");
    expect(measures.map((m) => m.name)).toContain("Plan 2 threshold unfrozen");
    expect(total).toBe(-0.008);
    // Employer NI changes no household's income: in More info, not a step
    expect(members.find((member) => member.id === "employer_ni_relief_under_25s").muted).toBe(true);
    expect(measures.some((m) => m.id === "employer_ni_relief_under_25s")).toBe(false);
  });

  it("steps by size in people out of poverty, closes the gap with an interaction step and ends at the package", () => {
    const { measures, total } = measurePovertyRows(rows, catalogue, ALL, 2027, "poverty_change_pp");
    // 70 million people: 0.001pp is 700 people
    const { steps, zero, peopleMode } = povertyWaterfall(measures, total, 70);
    expect(peopleMode).toBe(true);
    expect(steps.map((s) => [s.kind, s.id])).toEqual([
      ["measure", "plan_2_threshold_unfreeze"],
      ["measure", "state_pension_income_tax_protection"],
      ["interaction", "interaction"],
      ["total", "package"],
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
    const { measures } = measurePovertyRows(rows, catalogue, ["plan_2_threshold_unfreeze", "fuel_duty_rise_deferral"], 2027, "poverty_change_pp");
    const { steps, peopleMode } = povertyWaterfall(measures, null, null);
    expect(peopleMode).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(["measure"]);
    expect(steps[0].x).toBeCloseTo(0.005);
  });
});

describe("the Poverty sub-tab's measures pair", () => {
  it("is two cards in a row under one poverty choice: the change, then which measures move it", async () => {
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={metrics} policies={catalogue.measures} selectedPolicies={ALL} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const panel = document.body;
    const card = async (name) =>
      (await within(panel).findByRole("heading", { level: 3, name }, { timeout: 5000 })).closest(".charts-grid > div");
    const change = await card(/^Change in the poverty rate$/);
    const measures = await card(/^Which measures move poverty/);
    expect(change.parentElement).toBe(measures.parentElement);

    // The pair's one poverty choice sits above both cards, not in each
    const choice = within(panel).getByRole("group", { name: "Poverty measure" });
    expect(choice.nextElementSibling).toBe(change.parentElement);
    for (const c of [change, measures]) {
      expect(within(c).queryByRole("button", { name: /^Options:/ })).toBeNull();
    }
    // The change in people, from the outlook's population
    await waitFor(() => expect(change.querySelector(".chart-description")).toHaveTextContent(/2027-28: −0\.008pp \(≈[\d,]+ fewer people\)/), { timeout: 5000 });
    // A waterfall in people: short names, the package last; the measures
    // that move no one are in More info, not under the chart
    const rows = within(measures).getAllByRole("rowheader").map((r) => r.textContent);
    expect(rows[0]).toBe("Plan 2 threshold unfrozen");
    expect(rows.at(-1)).toBe("Package");
    expect(rows).not.toContain("Employer NI relief, under-25s");
    expect(measures.querySelector(".chart-legend .wf-none, .ls-chart-rows .wf-none")).toBeNull();
    expect(measures.querySelector(".wf-total .wf-main")).toHaveTextContent(/^≈[\d,]+ fewer$/);
    expect(measures.querySelector(".chart-description")).toHaveTextContent(/Biggest: Plan 2 threshold unfrozen, ≈[\d,]+ fewer people \(−0\.005pp\)/);

    // One poverty choice for both cards
    // One Options pill above the pair, its summary the measure
    fireEvent.click(within(choice).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(within(choice).getByRole("radiogroup", { name: "Poverty line" })).getByRole("radio", { name: "Relative" }));
    expect(within(choice).getByRole("button", { name: /^Options:/ })).toHaveTextContent(/^Relative · /);
    expect(new URLSearchParams(window.location.search).get("poverty")).toBe("relative-bhc-all");
    expect(change.querySelector(".chart-description")).toHaveTextContent(/relative/i);

    // More info: the £0 measures and that the parts need not add up
    fireEvent.click(within(measures).getByRole("button", { name: "More info" }));
    expect(within(measures).getByText(/need not add up to the package/)).toBeInTheDocument();
    const none = measures.querySelector(".wf-none");
    expect(none).toHaveTextContent(/^No effect on poverty: .*BADR restricted/);
    expect(none).toHaveTextContent(/change prices/);
    expect(within(measures).getByText(/Employer NI relief for under-25s/)).toBeInTheDocument();
  });
});

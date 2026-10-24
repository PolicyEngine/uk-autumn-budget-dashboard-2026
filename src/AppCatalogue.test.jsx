import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { fixtureJson, fixtureText, IN_DATA } from "./test/publicationFixture";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("./components/BudgetaryImpactChart", () => ({
  default: ({ data }) => <div data-testid="budget-figures" data-rows={JSON.stringify(data)} />,
}));
vi.mock("./components/DistributionalChart", () => ({
  default: ({ rawData, selectedPolicies }) => <div data-testid="distributional-figures" data-rows={JSON.stringify(rawData)} data-selected={JSON.stringify(selectedPolicies)} />,
}));
vi.mock("./components/WaterfallChart", () => ({ default: () => null }));
vi.mock("./components/ConstituencyMap", () => ({ default: () => null }));
vi.mock("./components/HouseholdScatter", () => ({ default: () => null }));
vi.mock("./components/EmploymentIncomeChart", () => ({ default: () => null }));
vi.mock("./components/EmploymentIncomeDiffChart", () => ({ default: () => null }));
vi.mock("./components/PersonalImpactTab", () => ({ default: () => null }));
vi.mock("./components/OBRComparisonTable", () => ({ default: () => null }));
vi.mock("./components/YoungPeopleSection", () => ({ default: () => null, YOUNG_PEOPLE_ANCHOR: "young-people" }));
vi.mock("./components/MethodologyTab", () => ({ default: () => null, METHOD_SECTIONS: { geography: "geography" } }));
vi.mock("./components/livingStandards/LivingStandardsTab", () => ({ default: () => null }));

beforeEach(() => { window.history.replaceState({}, "", "/"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the page's verified publication catalogue", () => {
  it("shows approved unseen IDs and metadata while excluding held rows", async () => {
    const manifest = fixtureJson("manifest.json");
    manifest.measures = Object.fromEntries(["alpha", "beta", "epsilon"].map((id) => [id, manifest.measures[id]]));
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest) } }));
    const { container } = render(<App />);
    const figures = await screen.findByTestId("distributional-figures");
    expect(new Set(JSON.parse(figures.dataset.selected))).toEqual(new Set(["alpha", "beta"]));
    const rows = JSON.parse(figures.dataset.rows);
    expect(new Set(rows.map((row) => row.reform_id))).toEqual(new Set(["alpha", "beta"]));
    expect(rows.every((row) => row.year === IN_DATA)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    const selector = within(container.querySelector(".policy-selector-dropdown"));
    expect(selector.getAllByRole("checkbox")).toHaveLength(2);
    expect(selector.getByText("Alpha")).toBeInTheDocument();
    expect(selector.getByText("Beta")).toBeInTheDocument();
    expect(selector.queryByText("Epsilon")).toBeNull();
  });

  it.each([{}, { ...fixtureJson("manifest.json"), release: "uk-autumn-budget-2025" }])("fails closed on invalid/current-release identity", async (manifest) => {
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest) } }));
    render(<App />);
    expect(await screen.findByText("Published results are unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
  });

  it("loads today's real public/data and renders no historical figure without a manifest", async () => {
    const historic = readFileSync(join(process.cwd(), "public/data/budgetary_impact.csv"), "utf8");
    expect(historic).toContain("two_child_limit");
    expect(readFileSync(join(process.cwd(), "public/data/obr_comparison.csv"), "utf8")).toContain("2025_combined");
    vi.stubGlobal("fetch", async (url) => {
      try { return new Response(readFileSync(join(process.cwd(), "public", String(url)))); }
      catch { return new Response(null, { status: 404 }); }
    });
    render(<App />);
    expect(await screen.findByText("No Budget results are published yet")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
    expect(screen.queryByTestId("distributional-figures")).toBeNull();
    expect(screen.queryByText(/9\.486/)).toBeNull();
  });

  it("never displays a stale flat figure when an approved output digest differs", async () => {
    const manifest = fixtureJson("manifest.json");
    manifest.measures = { alpha: { ...manifest.measures.alpha, outputs_sha256: "0".repeat(64) } };
    manifest.combined = {};
    const artifact = manifest.measures.alpha.artifact;
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest), "budgetary_impact.csv": fixtureText(`${artifact}/budgetary_impact.csv`) } }));
    render(<App />);
    const figures = await screen.findByTestId("distributional-figures");
    expect(JSON.parse(figures.dataset.rows)).toEqual([]);
    expect(JSON.parse(screen.getByTestId("budget-figures").dataset.rows).every((row) => row.netImpact === null)).toBe(true);
    expect(screen.getByText(/Alpha: Results unavailable/)).toBeInTheDocument();
  });
});

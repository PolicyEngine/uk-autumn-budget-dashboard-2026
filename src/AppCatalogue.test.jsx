import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import fc from "fast-check";
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
vi.mock("./components/MethodologyTab", () => ({ default: () => <div data-testid="methodology-view" />, METHOD_SECTIONS: { geography: "geography" } }));
vi.mock("./components/livingStandards/LivingStandardsTab", () => ({ default: () => <div data-testid="living-view" /> }));

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
    expect(await screen.findByText(/Alpha: Results unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId("distributional-figures")).toBeNull();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
  });

  it.each(["?tab=living", "?tab=methodology"])("keeps the shell and %s without a manifest", async (search) => {
    // Round-2 review: the views that need no Budget figures stay
    window.history.replaceState({}, "", `/${search}`);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    render(<App />);
    const view = search.includes("living") ? "living-view" : "methodology-view";
    expect(await screen.findByTestId(view)).toBeInTheDocument();
    expect(within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByText("No Budget results are published yet")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Population impact" }));
    expect(await screen.findByText("No Budget results are published yet")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
  });
});

describe("an open page follows the publication", () => {
  const twoMeasures = (status = "approved") => {
    const manifest = fixtureJson("manifest.json");
    manifest.measures = { alpha: { ...manifest.measures.alpha }, beta: { ...manifest.measures.beta, status } };
    return manifest;
  };
  const rowIds = () => new Set(JSON.parse(screen.getByTestId("distributional-figures").dataset.rows).map((row) => row.reform_id));

  it("replaces the figures when a newer manifest is published", async () => {
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(twoMeasures()) } }));
    render(<App />);
    await screen.findByTestId("distributional-figures");
    expect(rowIds()).toEqual(new Set(["alpha", "beta"]));
    // A correction withdraws beta while the page is open
    const next = twoMeasures("withdrawn");
    next.revision += 1;
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(next) } }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(rowIds()).toEqual(new Set(["alpha"])));
    expect(screen.getByText(/Newer results were published while this page was open/)).toBeInTheDocument();
  });

  it("takes the figures away when the manifest is withdrawn or invalid", async () => {
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(twoMeasures()) } }));
    render(<App />);
    await screen.findByTestId("distributional-figures");
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": 404 } }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("No Budget results are published yet")).toBeInTheDocument();
    expect(screen.queryByTestId("distributional-figures")).toBeNull();
  });

  it("suppresses figures on every revalidation failure and recovers on the next focus", async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom("unreachable", "500", "503", "invalid", "404"), async (failure) => {
      const approved = () => dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(twoMeasures()) } });
      vi.stubGlobal("fetch", approved());
      render(<App />);
      await screen.findByTestId("distributional-figures");
      expect(rowIds()).toEqual(new Set(["alpha", "beta"]));
      vi.stubGlobal("fetch", failure === "unreachable"
        ? async () => { throw new TypeError("Failed to fetch"); }
        : dashboardFixtureFetch({ overrides: { "manifest.json": failure === "invalid" ? "{}" : Number(failure) } }));
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      expect(await screen.findByText(failure === "404" ? "No Budget results are published yet" : "Published results are unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("distributional-figures")).toBeNull();
      expect(screen.queryByTestId("budget-figures")).toBeNull();

      // No reload is needed after an initial or subsequent failed request.
      vi.stubGlobal("fetch", approved());
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      await screen.findByTestId("distributional-figures");
      expect(rowIds()).toEqual(new Set(["alpha", "beta"]));
      cleanup();
    }), { numRuns: 15 });
  });

  it("recovers after the initial publication request fails", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    render(<App />);
    await screen.findByText("Published results are unavailable");
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { "manifest.json": JSON.stringify(twoMeasures()) } }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await screen.findByTestId("distributional-figures");
    expect(rowIds()).toEqual(new Set(["alpha", "beta"]));
  });
});


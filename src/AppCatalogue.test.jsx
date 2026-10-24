import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { fixtureJson } from "./test/publicationFixture";
import { ALPHA, BETA, HELD, YEAR, measureCatalogueFixture } from "./test/measureCatalogueFixture";

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

function csv(rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\n");
}

function validManifest(metadata) {
  const base = fixtureJson("manifest.json");
  return {
    ...base,
    measures: Object.fromEntries(Object.entries(metadata.measures).map(([id, entry]) => [id, { ...base.measures.alpha, ...entry }])),
    combined: {},
  };
}
function serve(fixture, manifest) {
  const files = {
    "budgetary_impact.csv": csv(fixture.budgetary),
    "distributional_impact.csv": csv(fixture.distributional),
    "winners_losers.csv": csv(fixture.winnersLosers),
    "metrics.csv": csv(fixture.budgetary),
  };
  return vi.fn(async (url) => {
    const file = String(url).split("/").at(-1);
    if (file === "manifest.json") return manifest === null
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } });
    return files[file] === undefined ? new Response(null, { status: 404 }) : new Response(files[file]);
  });
}
function openDescriptions(container) {
  fireEvent.click(screen.getByRole("button", { name: "About selected policies" }));
  return within(container.querySelector(".policy-details-content"));
}

beforeEach(() => { window.history.replaceState({}, "", "/"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the page's published measure catalogue", () => {
  it("loads unseen approved ids, their labels and descriptions, and lists a held measure only as unavailable", async () => {
    const fixture = measureCatalogueFixture();
    fixture.distributional.push({ reform_id: "unpublished_stale", reform_name: "Unpublished stale row", year: YEAR, decile: "1st", value: 999 });
    vi.stubGlobal("fetch", serve(fixture, validManifest(fixture.manifest)));
    const { container } = render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading published measures");
    const figures = await screen.findByTestId("distributional-figures");
    expect(new Set(JSON.parse(figures.dataset.selected))).toEqual(new Set([ALPHA, BETA]));
    expect(new Set(JSON.parse(figures.dataset.rows).map((row) => row.reform_id))).toEqual(new Set([ALPHA, BETA]));
    expect(screen.getByText(/Mock held measure: Not computable on current data/).closest('[role="status"]')).toHaveTextContent("Synthetic data limit");
    const budgetRows = JSON.parse(screen.getByTestId("budget-figures").dataset.rows);
    expect(budgetRows.find((point) => point.year === YEAR)).toMatchObject({ netImpact: 1, "Mock alpha support": -2, "Mock beta contribution": 3 });
    expect(JSON.stringify(budgetRows)).not.toContain("Mock held measure");

    const descriptions = openDescriptions(container);
    for (const id of [ALPHA, BETA]) {
      expect(descriptions.getByText(fixture.manifest.measures[id].name)).toBeInTheDocument();
      expect(descriptions.getByText(fixture.manifest.measures[id].description)).toBeInTheDocument();
    }
    expect(descriptions.queryByText(fixture.manifest.measures[HELD].name)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    const selector = within(container.querySelector(".policy-selector-dropdown"));
    expect(selector.getAllByRole("checkbox")).toHaveLength(2);
    expect(selector.queryByText(fixture.manifest.measures[HELD].name)).not.toBeInTheDocument();
    for (const id of [ALPHA, BETA]) expect(selector.getByText(fixture.manifest.measures[id].description)).toBeInTheDocument();
  });

  it("fails closed when a present manifest is invalid", async () => {
    vi.stubGlobal("fetch", serve(measureCatalogueFixture(), {}));
    render(<App />);
    expect(await screen.findByText("Published results are unavailable")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("invalid");
    expect(screen.queryByTestId("budget-figures")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select policies" })).not.toBeInTheDocument();
  });

  it("uses reviewed flat CSV metadata when the manifest is absent", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.budgetary.find((row) => row.reform_id === ALPHA).reform_name = "CSV alpha award";
    fixture.budgetary.find((row) => row.reform_id === ALPHA).reform_description = "An explanation published in the reviewed CSV.";
    vi.stubGlobal("fetch", serve(fixture, null));
    const { container } = render(<App />);
    const figures = await screen.findByTestId("distributional-figures");
    expect(new Set(JSON.parse(figures.dataset.selected))).toEqual(new Set([ALPHA, BETA]));
    const descriptions = openDescriptions(container);
    expect(descriptions.getByText("CSV alpha award")).toBeInTheDocument();
    expect(descriptions.getByText("An explanation published in the reviewed CSV.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    expect(within(container.querySelector(".policy-selector-dropdown")).getByText("CSV alpha award")).toBeInTheDocument();
  });
});

import { cloneElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WaterfallChart from "./WaterfallChart";
import BudgetaryImpactChart from "./BudgetaryImpactChart";
import { MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { budgetChartData, loadDashboard } from "../utils/loadDashboard";
import { BASE_PATH, BEYOND_DATA, fixtureFetch, IN_DATA } from "../test/publicationFixture";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    // A fixed size, so the chart draws in jsdom
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 800, height: 500 }}>
        {cloneElement(children, { width: 800, height: 500 })}
      </div>
    ),
  };
});

// One published year (2030); 2031 is in budget_years.json but not here.
const rows = ["1", "2"].map((decile) => ({
  reform_id: "two_child_limit",
  year: "2030",
  decile,
  avg_change: "120.5",
}));

describe("a year not yet published", () => {
  it("shows the decile chart's not-published state, with no zero bars", () => {
    const { container } = render(
      <WaterfallChart
        rawData={rows}
        selectedPolicies={["two_child_limit"]}
        selectedYear={2031}
      />,
    );
    expect(
      screen.getByText("We have not yet published results for 2031-32."),
    ).toBeInTheDocument();
    expect(container.querySelector(".recharts-bar-rectangle")).toBeNull();
    expect(container.textContent).not.toMatch(/£0/);
  });

  it("tags the revenue chart's empty year as not yet published", async () => {
    // The real synthetic artifacts verify through the production receipt
    // loader; chart points use the catalogue's namespaced measure keys.
    const published = await loadDashboard(BASE_PATH, { fetchImpl: fixtureFetch() });
    const data = budgetChartData(
      published.budgetary,
      published.catalogue.displayable,
      published.catalogue.displayable.map((measure) => measure.id),
      [IN_DATA, BEYOND_DATA],
    );
    const { container } = render(
      <MeasureCatalogueProvider catalogue={published.catalogue}>
        <BudgetaryImpactChart data={data} selectedYear={BEYOND_DATA} />
      </MeasureCatalogueProvider>,
    );
    expect(container.querySelector(".recharts-wrapper")).not.toBeNull();
    expect(container.textContent).toContain("Not yet published");
    expect(container.textContent).not.toContain("£0.0bn");
  });
});

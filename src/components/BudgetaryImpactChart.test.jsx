import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { render, screen } from "@testing-library/react";
import BudgetaryImpactChart, { measureOrder } from "./BudgetaryImpactChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, measureCatalogueFixture, YEAR } from "../test/measureCatalogueFixture";

// Recharts ResponsiveContainer measures the parent in jsdom and refuses
// to render its children when width / height resolve to zero. Replace it
// with a fixed-size wrapper so the BarChart renders deterministic ticks.
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div data-testid="recharts-responsive-container" style={{ width: 800, height: 500 }}>
        {children}
      </div>
    ),
  };
});

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const mockData = [{
  year: YEAR,
  ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, 2])),
  netImpact: 4,
}];

describe("BudgetaryImpactChart", () => {
  it("shows no figures without a verified catalogue", () => {
    fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), (value) => {
      const view = render(<BudgetaryImpactChart data={[{ year: YEAR, netImpact: value }]} />);
      expect(screen.getByRole("status")).toHaveTextContent("Revenue figures are unavailable");
      expect(screen.queryByTestId("recharts-responsive-container")).not.toBeInTheDocument();
      view.unmount();
    }), { numRuns: 20 });
  });
  it("renders a recharts ResponsiveContainer", () => {
    render(<MeasureCatalogueProvider catalogue={catalogue}><BudgetaryImpactChart data={mockData} /></MeasureCatalogueProvider>);
    expect(
      screen.getByTestId("recharts-responsive-container"),
    ).toBeInTheDocument();
  });

  it("orders raisers before costs, each group by size (the catalogue's groups)", () => {
    const keyOf = (id) => catalogue.byId.get(id).seriesKey;
    const order = measureOrder(mockData, catalogue);
    expect(order).toEqual([keyOf(BETA), keyOf(ALPHA)]);
  });
});

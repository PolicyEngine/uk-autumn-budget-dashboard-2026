import { cloneElement } from "react";
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen } from "@testing-library/react";
import BudgetaryImpactChart, { measureOrder, revenueInfo } from "./BudgetaryImpactChart";
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
        {cloneElement(children, { width: 800, height: 500 })}
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

  it("says so in place of an empty plot when no selected measure moves revenue in any year shown", () => {
    const zero = [YEAR, YEAR + 1].map((year) => ({
      year,
      ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, 0])),
      netImpact: 0,
    }));
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}><BudgetaryImpactChart data={zero} selectedYear={YEAR} selectedPolicies={[ALPHA]} /></MeasureCatalogueProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("None of the selected policies changes revenue in");
    // Only the selection's reasons: an unselected measure is never named
    expect(screen.getByRole("status")).not.toHaveTextContent(catalogue.byId.get(BETA).name);
    expect(screen.queryByTestId("recharts-responsive-container")).not.toBeInTheDocument();
    // Said once, and no empty key
    expect(container.querySelector(".chart-description").textContent).not.toMatch(/roughly balance|no revenue/);
    expect(container.querySelector(".revenue-key")).toBeNull();
  });

  it("orders raisers before costs, each group by size (the catalogue's groups)", () => {
    const keyOf = (id) => catalogue.byId.get(id).seriesKey;
    const order = measureOrder(mockData, catalogue);
    expect(order).toEqual([keyOf(BETA), keyOf(ALPHA)]);
  });

  it("highlights two measures together from its chips, and lets one go on a second click", () => {
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <BudgetaryImpactChart data={mockData} selectedYear={YEAR} />
      </MeasureCatalogueProvider>,
    );
    const chips = [...container.querySelectorAll("button.measure-key-chip:not(.is-net)")];
    expect(chips).toHaveLength(catalogue.displayable.length);
    // The net line has a chip of its own, chosen the same way
    expect(container.querySelector("button.measure-key-chip.is-net")).toHaveAttribute("aria-pressed", "false");
    const [first, second] = chips;
    // None selected: every chip as normal
    for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveClass("is-active");
    expect(second).toHaveClass("is-active");
    // A second click deselects it; the other stays
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
    // Clear unpins the rest
    fireEvent.click(screen.getByRole("button", { name: /^Clear the/ }));
    for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  describe("2026-27", () => {
    const ids = catalogue.displayable.map((measure) => measure.id);
    const point = (year, value) => ({
      year,
      ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, value])),
      netImpact: value * catalogue.displayable.length,
      unpublished: false,
    });
    const renderChart = (data) =>
      render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <BudgetaryImpactChart data={data} selectedYear={YEAR} selectedPolicies={ids} />
        </MeasureCatalogueProvider>,
      );

    it("is a bar like any other year when the data has it, with no note about it", () => {
      const { container } = renderChart([point(2026, -1), point(YEAR, 2)]);
      const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((tick) => tick.textContent);
      expect(ticks).toContain("2026-27");
      fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
      expect(container).not.toHaveTextContent(/before the years shown/i);
      // The net line names both gaps from a combined run and links to them
      // (critic W1, round 3)
      expect(container).toHaveTextContent(/leaves out interactions between them\./);
      expect(container).not.toHaveTextContent(/difference between the baselines/);
      expect(screen.getByRole("link", { name: "Policies added up" })).toHaveAttribute("href", "?tab=methodology#method-limitations");
    });

    it("is absent when the data starts at 2027-28", () => {
      const { container } = renderChart([point(YEAR, 2)]);
      const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((tick) => tick.textContent);
      expect(ticks).not.toContain("2026-27");
      expect(container).not.toHaveTextContent(/before the years shown/i);
    });
  });

  it("points to a later year in which the measures turn from costing revenue to raising it", () => {
    const point = (year, net) => ({
      year,
      ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, net / 2])),
      netImpact: net,
    });
    const data = [point(YEAR - 1, -8), point(YEAR, -6), point(YEAR + 1, 3)];
    const view = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <BudgetaryImpactChart data={data} selectedYear={YEAR - 1} />
      </MeasureCatalogueProvider>,
    );
    expect(view.container.querySelector(".later-years-note")).toHaveTextContent(
      `Later years differ: in ${YEAR + 1}-${String(YEAR + 2).slice(-2)}, the selected policies raise revenue.`,
    );
    view.unmount();
    // No turn after the year shown: no pointer
    const last = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <BudgetaryImpactChart data={data} selectedYear={YEAR + 1} />
      </MeasureCatalogueProvider>,
    );
    expect(last.container.querySelector(".later-years-note")).toBeNull();
  });
});


describe("what the revenue chart's About says of its net line", () => {
  it("names the combined run when the net line is one, and how far it is from the bars", () => {
    const run = revenueInfo([{ year: 2027, netImpact: 0.6996, barsSum: 0.7, netFromPackage: true }]);
    expect(run.how).toEqual([
      "Each bar is one policy on its own against current law; the net line is all the policies run together, so it captures the interactions between them.",
      "Here the interactions come to under £1m a year: the net line and the bars added up agree within £1m.",
    ]);
    const apart = revenueInfo([{ year: 2027, netImpact: 0.65, barsSum: 0.7, netFromPackage: true }]);
    expect(apart.how[1]).toBe("Here the interactions come to up to £50m a year: the gap between the net line and the bars added up.");
  });

  it("says the net line adds up the bars without one", () => {
    expect(revenueInfo([{ year: 2027, netImpact: 0.7 }]).how[0]).toBe(
      "Each bar is one policy on its own against current law; the net line adds up the bars.",
    );
  });
});

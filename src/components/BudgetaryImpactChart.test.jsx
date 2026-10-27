import { cloneElement } from "react";
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen } from "@testing-library/react";
import BudgetaryImpactChart, { beforeYearsLine, measureOrder } from "./BudgetaryImpactChart";
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

  describe("the year before the chart's first", () => {
    const whd = { id: "whd", seriesKey: "measure:whd", name: "Warm Home Discount top-up" };
    const vat = { id: "vat", seriesKey: "measure:vat", name: "Zero VAT on domestic electricity" };
    const shown = [2027, 2028].map((year) => ({ year, "measure:whd": 0, "measure:vat": -1.38, netImpact: -1.38 }));
    const before = { year: 2026, "measure:whd": -0.52, "measure:vat": -0.69, netImpact: -1.21, unpublished: false };

    it("gives the selection's effect, naming a measure whose whole effect falls in it", () => {
      expect(beforeYearsLine(before, shown, [whd, vat])).toBe(
        "In 2026-27, before the years shown, the selected policies cost £1.2bn, including all of the Warm Home Discount top-up.",
      );
      expect(beforeYearsLine({ ...before, "measure:whd": 0, netImpact: -0.69 }, shown, [vat])).toBe(
        "In 2026-27, before the years shown, the selected policy costs £0.7bn.",
      );
    });

    it("names a measure once: not when the card's note already does", () => {
      expect(beforeYearsLine({ ...before, "measure:vat": 0, netImpact: -0.52 }, shown, [whd], ["whd"])).toBe(
        "In 2026-27, before the years shown, the selected policy costs £0.5bn.",
      );
    });

    it("says nothing when the year is zero or a selected measure has no verified figure", () => {
      expect(beforeYearsLine({ ...before, "measure:whd": 0, "measure:vat": 0, netImpact: 0 }, shown, [whd, vat])).toBeNull();
      expect(beforeYearsLine({ year: 2026, netImpact: null, unpublished: true }, shown, [whd])).toBeNull();
      expect(beforeYearsLine(null, shown, [whd])).toBeNull();
    });

    it("puts the line first in About this chart, not under the chart", () => {
      const point = { year: YEAR - 1, ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, -1])), netImpact: -catalogue.displayable.length, unpublished: false };
      const ids = catalogue.displayable.map((measure) => measure.id);
      const { container } = render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <BudgetaryImpactChart data={mockData} before={point} selectedYear={YEAR} selectedPolicies={ids} />
        </MeasureCatalogueProvider>,
      );
      expect(container.querySelector(".chart-footer .note")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
      const first = container.querySelector(".chart-more-info .info-section");
      expect(first).toHaveTextContent(/^Before the years shown/);
      expect(first).toHaveTextContent(/before the years shown, the selected polic(y|ies) costs? £\d+\.\dbn\./);
    });

    it("leaves About this chart without the item when there is no line", () => {
      const ids = catalogue.displayable.map((measure) => measure.id);
      const { container } = render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <BudgetaryImpactChart data={mockData} before={null} selectedYear={YEAR} selectedPolicies={ids} />
        </MeasureCatalogueProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
      expect(container.querySelector(".chart-more-info")).not.toHaveTextContent(/Before the years shown/);
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
      `Later years differ: in ${YEAR + 1}-${String(YEAR + 2).slice(-2)}, the selected measures raise revenue.`,
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


import { cloneElement } from "react";
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen, within } from "@testing-library/react";
import BudgetaryImpactChart, { measureOrder } from "./BudgetaryImpactChart";
import { ABOUT_THIS_CHART } from "./ChartMoreInfo";
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
});

describe("BudgetaryImpactChart's About this chart", () => {
  const about = (props) => {
    const view = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <BudgetaryImpactChart data={mockData} selectedYear={YEAR} {...props} />
      </MeasureCatalogueProvider>,
    );
    const card = view.container.querySelector(".chart-footer > .chart-more-info");
    fireEvent.click(within(card).getByRole("button", { name: ABOUT_THIS_CHART }));
    const result = {
      how: [...card.querySelectorAll(".info-list li")].map((item) => item.textContent),
      links: [...card.querySelectorAll("a.method-link")].map((link) => link.getAttribute("href")),
    };
    view.unmount();
    return result;
  };

  it("on this Budget's page, says how Plan 2 is costed and links to Methodology", () => {
    const own = about({});
    expect(own.how).toContainEqual(expect.stringMatching(/^The Plan 2 student loan measure/));
    expect(own.links).toEqual([expect.stringMatching(/^\?tab=methodology#/)]);
  });

  it("on a past event's page, names no measure of this Budget's and links to no Methodology", () => {
    const own = about({});
    const past = about({ pastEvent: true });
    expect(past.how.join(" ")).not.toMatch(/Plan 2/);
    expect(past.links).toEqual([]);
    // Every other line is the same
    expect(past.how).toEqual(own.how.filter((line) => !/Plan 2/.test(line)));
    expect(past.how.length).toBeGreaterThan(0);
  });
});

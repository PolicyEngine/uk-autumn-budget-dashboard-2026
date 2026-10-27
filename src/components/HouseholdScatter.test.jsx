import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseScatterCsv } from "../utils/householdScatter";

const HEADER =
  "reform_id,reform_name,year,income_band,change_band,change_band_upper,households,income_basis_year";
// Measure a changes no household's income in 2027 (every cell in the zero
// band) and some in 2028
const CSV = [
  HEADER,
  "a,Measure A,2027,20000.0,-1.0,1.0,151000.0,2027",
  "a,Measure A,2027,25000.0,-1.0,1.0,98000.0,2027",
  "a,Measure A,2028,20000.0,-150.0,-100.0,140000.0,2027",
  "a,Measure A,2028,25000.0,-1.0,1.0,98000.0,2027",
].join("\n");

vi.mock("../hooks/useHouseholdScatterData", () => ({
  useHouseholdScatterData: () => ({ status: "ready", rows: parseScatterCsv(CSV), error: null }),
}));
// Recharts draws nothing in jsdom: the chart's margin and the parts it
// draws in its SVG (the y-axis title, the logo) are recorded instead
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    ScatterChart: ({ margin, children }) => (
      <div data-testid="scatter-chart" data-margin={JSON.stringify(margin)}>{children}</div>
    ),
    CartesianGrid: () => null,
    XAxis: ({ label }) => <span data-testid="x-title">{label?.value}</span>,
    YAxis: () => null,
    ReferenceLine: () => null,
    Customized: ({ component }) => (
      <span
        data-testid="in-svg"
        data-part={component.props?.text ? "unit-label" : (component.name ?? component.type?.name)}
      >
        {component.props?.text}
      </span>
    ),
  };
});
vi.mock("../utils/measureCatalogue", () => ({
  useMeasureCatalogue: () => ({ combinedId: null, byId: new Map() }),
}));

const { default: HouseholdScatter, LOGO_ROOM } = await import("./HouseholdScatter");
const { chartMargin } = await import("../utils/chartTheme");
const { CHART_LOGO } = await import("../utils/chartLogo");

const POLICIES = [{ id: "a", name: "Measure A" }];

describe("HouseholdScatter with no change in household incomes", () => {
  it("shows the shared note, not a column of dots at £0, when every published cell is in the zero band", () => {
    render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    expect(screen.getByText("None of the selected policies changes household incomes in 2027-28.")).toBeTruthy();
    expect(screen.queryByLabelText("Key")).toBeNull();
  });

  it("draws the plot in a year the measure changes incomes, its key in the sentence", () => {
    const { container } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    expect(screen.queryByText(/None of the selected policies changes household incomes/)).toBeNull();
    expect(screen.getByTestId("scatter-chart")).toBeTruthy();
    // Gain and loss are keyed by dots beside their words, not a row under the plot
    const description = container.querySelector(".chart-description");
    expect(description.textContent).toMatch(/right of the line they gain, left they lose\./);
    expect(description.querySelectorAll(".scatter-key-word .scatter-legend-dot")).toHaveLength(2);
    expect(screen.queryByLabelText("Key")).toBeNull();
  });
});

describe("HouseholdScatter beside the income decile card", () => {
  it("draws its plot, axis title and logo as the decile chart does: same margins, logo in the SVG", () => {
    const { container } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    const margin = JSON.parse(screen.getByTestId("scatter-chart").dataset.margin);
    // WaterfallChart and DistributionalChart: chartMargin's top, and their
    // LOGO_ROOM under the axis with the section's key above the pair
    expect(margin.top).toBe(chartMargin(false).top);
    expect(margin.bottom).toBe(CHART_LOGO.height + CHART_LOGO.padding + 6);
    expect(margin.bottom).toBe(LOGO_ROOM);
    const parts = screen.getAllByTestId("in-svg").map((node) => node.dataset.part);
    expect(parts).toContain("PolicyEngineLogo");
    expect(container.querySelector(".chart-logo")).toBeNull();
    expect(container.querySelector(".chart-legend")).toBeNull();
  });

  it("titles the y axis by income before the policies, the same in every year (the bands are fixed in the basis year)", () => {
    const title = () =>
      screen.getAllByTestId("in-svg").find((node) => node.dataset.part === "unit-label").textContent;
    const { rerender } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    expect(title()).toBe("Household net income before the policies (£k)");
    expect(screen.getByRole("heading").textContent).toContain("2028-29");
    rerender(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    // 2027 has no change: the note replaces the plot; back to 2028 the title holds
    rerender(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    expect(title()).not.toMatch(/20\d\d-\d\d/);
  });

  it("with the reader's household keeps a key row (with You) and the logo under it", () => {
    const { container } = render(
      <HouseholdScatter
        selectedPolicies={["a"]}
        policies={POLICIES}
        selectedYear={2028}
        you={{ change: -120, income: 22000 }}
      />,
    );
    const key = screen.getByLabelText("Key");
    expect(key.textContent).toBe("GainLossYou");
    expect(container.querySelector(".chart-logo img")).toBeTruthy();
    expect(screen.getAllByTestId("in-svg").map((node) => node.dataset.part)).not.toContain("PolicyEngineLogo");
    expect(JSON.parse(screen.getByTestId("scatter-chart").dataset.margin).bottom).toBe(0);
  });
});

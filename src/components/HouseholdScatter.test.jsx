import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  "b,Measure B,2028,30000.0,100.0,150.0,50000.0,2027",
  "c,Measure C,2028,35000.0,100.0,150.0,40000.0,2027",
  "combined--ab,A and B,2028,40000.0,-150.0,-100.0,60000.0,2027",
  "combined--abc,A B and C,2028,40000.0,-150.0,-100.0,70000.0,2027",
].join("\n");

// One loaded file, the same object on every render, as the real hook keeps it
let scatterData = null;
vi.mock("../hooks/useHouseholdScatterData", () => ({
  useHouseholdScatterData: () => (scatterData ??= { status: "ready", rows: parseScatterCsv(CSV), error: null }),
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
// Measures a, b and c; a combined run is published for exactly a and b only
const approved = { status: "approved", outputs_sha256: "a".repeat(64) };
const MANIFEST = {
  measures: { a: approved, b: approved, c: approved },
  combined: {
    "combined--ab": {
      status: "approved",
      measures: ["a", "b"],
      member_outputs_sha256: { a: "a".repeat(64), b: "a".repeat(64) },
    },
  },
};
// Each verified artifact's tables, as the page's catalogue holds them; a
// test sets the income decile rows the card reads beside the scatter
let tablesByKey = undefined;
// The full package's run (the catalogue's combinedId), when a test sets it
let combinedId = null;
vi.mock("../utils/measureCatalogue", () => ({
  useMeasureCatalogue: () => ({ combinedId, byId: new Map(), manifest: MANIFEST, tablesByKey }),
}));

const { default: HouseholdScatter, LOGO_ROOM } = await import("./HouseholdScatter");
const { chartMargin } = await import("../utils/chartTheme");
const { CHART_LOGO } = await import("../utils/chartLogo");
const { WITHHELD_DECILE_MESSAGE } = await import("../utils/decileWithholding");

const POLICIES = [
  { id: "a", name: "Measure A" },
  { id: "b", name: "Measure B" },
  { id: "c", name: "Measure C" },
];

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

// Measure a's income decile results in 2027, the year its published cells
// are all in the zero band
const decileRows = (values) => ({
  a: {
    distributional_impact: values.map((value, index) => ({
      reform_id: "a",
      reform_name: "Measure A",
      year: 2027,
      decile: `${index + 1}${["st", "nd", "rd"][index] ?? "th"}`,
      value,
    })),
  },
});

describe("HouseholdScatter when the groups that change are withheld", () => {
  afterEach(() => {
    tablesByKey = undefined;
  });

  const NOTE =
    "Households that gain or lose: not published, to protect survey respondents' confidentiality (too few survey households). The income decile chart shows the average change.";

  it("draws the published no-change dots and labels the withheld groups when the deciles change (the Carer's Allowance taper, 2031-32)", () => {
    // Deciles 7 and 9 withheld, the rest non-zero, as the taper publishes
    tablesByKey = decileRows([0.0036, 0.0067, 0.0007, 0.0099, 0.0059, -0.0008, "", 0.002, "", 0.00005]);
    const { container } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    expect(screen.getByTestId("scatter-chart")).toBeTruthy();
    expect(screen.getByRole("note")).toHaveTextContent(NOTE);
    expect(NOTE).toContain(WITHHELD_DECILE_MESSAGE.slice(1));
    expect(screen.queryByText(/None of the selected policies changes household incomes/)).toBeNull();
    // Dots are drawn, so the dot subtitle is back
    expect(container.querySelector(".chart-description").textContent).toMatch(/^Each dot is about/);
  });

  it("does the same when every decile is withheld", () => {
    tablesByKey = decileRows(Array(10).fill(""));
    render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    expect(screen.getByTestId("scatter-chart")).toBeTruthy();
    expect(screen.getByRole("note")).toHaveTextContent(NOTE);
  });

  it("keeps 'None of the selected policies…', with the plain subtitle and no dots, for a true zero: every decile published at zero", () => {
    tablesByKey = decileRows(Array(10).fill(0));
    const { container } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    expect(screen.getByRole("status")).toHaveTextContent("None of the selected policies changes household incomes in 2027-28.");
    expect(screen.queryByTestId("scatter-chart")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    const description = container.querySelector(".chart-description");
    expect(description.textContent).toMatch(/^Change in net income by baseline income\./);
    expect(description.textContent).not.toMatch(/Each dot/);
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

  it("titles the y axis by income under current law (HH6, round 3), the same in every year (the bands are fixed in the basis year)", () => {
    const title = () =>
      screen.getAllByTestId("in-svg").find((node) => node.dataset.part === "unit-label").textContent;
    const { rerender } = render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    expect(title()).toBe("Household net income under current law (£k)");
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

describe("HouseholdScatter shows the header's selection", () => {
  const titleOf = (container) => container.querySelector("h3").textContent;

  it("one policy: that policy's cells, with no Policy pill of its own", () => {
    const { container } = render(<HouseholdScatter selectedPolicies={["b"]} policies={POLICIES} selectedYear={2028} />);
    expect(screen.getByTestId("scatter-chart")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Policy shown/ })).toBeNull();
    expect(container.querySelector(".pill-select")).toBeNull();
    expect(titleOf(container)).not.toMatch(/Measure B/);
  });

  it("several policies: the published combined run of exactly them, with no Policy pill", () => {
    const { container } = render(<HouseholdScatter selectedPolicies={["b", "a"]} policies={POLICIES} selectedYear={2028} />);
    expect(screen.getByTestId("scatter-chart")).toBeTruthy();
    expect(container.querySelector(".pill-select")).toBeNull();
    // Not one member's run in its place
    expect(titleOf(container)).not.toMatch(/Measure [AB]/);
  });

  it("several policies with no published combined run: the not-published notice, never one policy", () => {
    const { container } = render(<HouseholdScatter selectedPolicies={["a", "c"]} policies={POLICIES} selectedYear={2028} />);
    expect(
      screen.getByText("Household results for this combination of policies are not published yet."),
    ).toBeTruthy();
    expect(screen.queryByTestId("scatter-chart")).toBeNull();
    expect(container.querySelector(".pill-select")).toBeNull();
    expect(titleOf(container)).not.toMatch(/Measure [AC]/);
  });

  describe("with the full package published", () => {
    afterEach(() => {
      combinedId = null;
    });

    it("some but not all policies: one run at a time, with buttons for all of them and the first alone", () => {
      combinedId = "combined--abc";
      const onPoliciesSet = vi.fn();
      render(
        <HouseholdScatter selectedPolicies={["c", "a"]} policies={POLICIES} selectedYear={2028} onPoliciesSet={onPoliciesSet} />,
      );
      expect(screen.getByText("This chart shows one policy at a time, or all three together.")).toBeTruthy();
      expect(screen.queryByText(/not published yet/)).toBeNull();
      expect(screen.queryByTestId("scatter-chart")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show all three" }));
      expect(onPoliciesSet).toHaveBeenLastCalledWith(["a", "b", "c"]);
      // The first selected in the page's order
      fireEvent.click(screen.getByRole("button", { name: "Show Measure A alone" }));
      expect(onPoliciesSet).toHaveBeenLastCalledWith(["a"]);
    });

    it("draws no buttons without the picker's setter (the Household calculator)", () => {
      combinedId = "combined--abc";
      render(<HouseholdScatter selectedPolicies={["a", "c"]} policies={POLICIES} selectedYear={2028} />);
      expect(screen.getByText("This chart shows one policy at a time, or all three together.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
    });
  });
});

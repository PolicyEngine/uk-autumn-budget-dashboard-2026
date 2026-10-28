import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WaterfallChart from "./WaterfallChart";
import DistributionalChart from "./DistributionalChart";
import YoungPeopleSection from "./YoungPeopleSection";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

// A chart drawn at a percentage height (ResponsiveContainer height="100%")
// takes its plot's height. Anything else in the plot above it (a note, a
// notice, even one kept hidden) is then added to the plot on every measure:
// in a pair of cards, whose shared rows grow with the taller plot, the chart
// and the card beside it grow without end (production, 28 Oct: All
// households' decile card and the household scatter, 2,312px to 52,629px in
// 20s at 1440px). jsdom has no layout, so the loop itself can't run here;
// this checks its cause: a chart at a percentage height is alone in its plot.

vi.setConfig({ testTimeout: 30000 });

vi.mock("recharts", async () => {
  const Chart = ({ children }) => <div data-testid="chart">{children}</div>;
  const Empty = () => null;
  return {
    ComposedChart: Chart, BarChart: Chart, ScatterChart: Chart,
    // The height the component asked for, as Recharts would size by it
    ResponsiveContainer: ({ height, children }) => (
      <div className="recharts-responsive-container" data-height={String(height)}>{children}</div>
    ),
    Bar: Empty, Scatter: Empty, Cell: Empty, Tooltip: Empty, Legend: Empty,
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty,
    ReferenceArea: Empty, ReferenceLine: Empty, LabelList: Empty, Customized: Empty,
  };
});
vi.mock("./ChartDownloadMenu", () => ({ default: () => null }));
vi.mock("../utils/loadDashboard", async (importOriginal) => {
  const actual = await importOriginal();
  const { parseTable } = await import("../utils/publication/csv");
  const { isCatalogueRowDisplayable } = await import("../utils/measureCatalogue");
  return {
    ...actual,
    loadVerifiedTable: async (catalogue, table) => {
      const response = await fetch(`/data/${table}.csv`);
      if (!response.ok) throw new Error(`${table} is unavailable`);
      return parseTable(table, await response.text()).filter((row) =>
        isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
      );
    },
  };
});
vi.mock("../utils/chartLogo", () => ({
  PolicyEngineLogo: () => null,
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Whether anything in the chart's plot comes before it. */
function crowded(chart) {
  const plot = chart.closest(".chart-plot");
  for (let node = chart; node && node !== plot; node = node.parentElement) {
    if (node.previousElementSibling) return true;
  }
  return false;
}

/** Each chart drawn at a percentage height with something above it in its plot. */
function loops(container) {
  const charts = [...container.querySelectorAll(".recharts-responsive-container")];
  expect(charts.length).toBeGreaterThan(0);
  return charts.filter((chart) => chart.dataset.height.endsWith("%") && crowded(chart)).map((chart) => chart.dataset.height);
}

function rendered(fixture, element) {
  return render(<MeasureCatalogueProvider catalogue={buildMeasureCatalogue(fixture)}>{element}</MeasureCatalogueProvider>);
}

describe("no chart can grow its plot without end", () => {
  it.each([
    ["the decile change, nothing withheld (the withheld note's line is kept, hidden)", WaterfallChart, "winnersLosers", null],
    ["the decile change, a decile withheld", WaterfallChart, "winnersLosers", ["avg_change", "1"]],
    ["the relative decile change, nothing withheld", DistributionalChart, "distributional", null],
    ["the relative decile change, a decile withheld", DistributionalChart, "distributional", ["value", "1st"]],
  ])("%s", (_name, Chart, source, withhold) => {
    const fixture = measureCatalogueFixture({ held: false });
    const rows = withhold
      ? fixture[source].map((row) => (row.reform_id === ALPHA && row.decile === withhold[1] ? { ...row, [withhold[0]]: null } : row))
      : fixture[source];
    const { container } = rendered(fixture, <Chart rawData={rows} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />);
    expect(loops(container)).toEqual([]);
  });

  it.each([
    ["the decile change", WaterfallChart, "winnersLosers"],
    ["the relative decile change", DistributionalChart, "distributional"],
  ])("%s, with a measure's results unavailable (the notice above the plot)", (_name, Chart, source) => {
    const fixture = measureCatalogueFixture({ held: false });
    const rows = fixture[source].filter((row) => row.reform_id !== BETA);
    const { container } = rendered(fixture, <Chart rawData={rows} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />);
    expect(screen.getByRole("status")).toHaveTextContent("The net change is unavailable");
    expect(loops(container)).toEqual([]);
  });

  it.each([
    ["every band published", [ALPHA, BETA], () => true, false],
    // One measure missing a band: drawn, under the notice (several missing
    // one are not published together, a note in place of the plot)
    ["one measure missing a band (the notice above the plot)", [ALPHA], (line, first) => line !== first, true],
  ])("the average change by age, %s", async (_name, selected, keep, notice) => {
    const fixture = measureCatalogueFixture({ held: false });
    const [header, ...lines] = fixture.ageCsv.split("\n");
    const first = lines.find((line) => line.startsWith(`${ALPHA},`) && line.includes(`,${YEAR},`));
    const ageCsv = [header, ...lines.filter((line) => keep(line, first))].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => ageCsv })));
    const { container } = rendered(
      fixture,
      <YoungPeopleSection policies={buildMeasureCatalogue(fixture).measures} selectedPolicies={selected} selectedYear={YEAR} />,
    );
    await screen.findAllByTestId("chart");
    expect(screen.queryAllByText(/no published results by age/).length > 0).toBe(notice);
    expect(loops(container)).toEqual([]);
  });
});

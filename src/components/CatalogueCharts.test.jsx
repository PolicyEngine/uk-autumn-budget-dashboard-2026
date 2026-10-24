import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { meanChangeByBand } from "../utils/ageImpact";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BudgetaryImpactChart from "./BudgetaryImpactChart";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import HouseholdChart from "./HouseholdChart";
import YoungPeopleSection from "./YoungPeopleSection";
import GroupedLegend from "./GroupedLegend";
import ChartTooltip from "./ChartTooltip";
import PolicySelector from "./PolicySelector";
import {
  buildMeasureCatalogue,
  MeasureCatalogueProvider,
} from "../utils/measureCatalogue";
import {
  ALPHA, BETA, HELD, COMBINED, YEAR, measureCatalogueFixture,
} from "../test/measureCatalogueFixture";

// Exercise each chart's actual data preparation and series wiring in jsdom.
// Geometry and animation are Recharts' responsibility; no browser is launched.
// Multiple chart cards and accessible queries need room in the shared jsdom runner.
vi.setConfig({ testTimeout: 30000 });

vi.mock("recharts", async () => {
  const React = await import("react");
  const ChartData = React.createContext([]);
  const Chart = ({ data, children }) => {
    const rows = data ?? React.Children.toArray(children).find((child) => Array.isArray(child.props?.data))?.props.data ?? [];
    return (
      <ChartData.Provider value={rows}>
        <div data-testid="chart-rows" data-rows={JSON.stringify(rows)}>{children}</div>
      </ChartData.Provider>
    );
  };
  const Bar = ({ dataKey, name, fill, hide }) => hide ? null : <span data-testid="measure-series" data-measure={dataKey} data-label={name} data-color={fill} />;
  const Tooltip = ({ content }) => {
    const rows = React.useContext(ChartData);
    return content?.type?.name === "CustomTooltip" && rows.length
      ? React.cloneElement(content, { active: true, payload: [{ payload: rows[0] }] })
      : null;
  };
  const Empty = () => null;
  return {
    ComposedChart: Chart, BarChart: Chart, ScatterChart: Chart,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    Bar, Scatter: Empty, Cell: Empty, Tooltip,
    Legend: ({ content }) => <div data-testid="chart-legend">{content}</div>,
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty,
    ReferenceArea: Empty, ReferenceLine: Empty, LabelList: Empty, Customized: Empty,
  };
});
vi.mock("./ChartDownloadMenu", () => ({ default: () => null }));
// The receipt route is tested in src/hooks/useIncomeCurve.test.js and
// src/utils/publication/flat.test.js; here the age table arrives as the
// verified, gated rows that route returns.
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
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17 },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const catalogueFor = (fixture) => buildMeasureCatalogue(fixture);
function withCatalogue(catalogue, children) {
  return <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;
}
const chartRows = (container) => JSON.parse(container.querySelector('[data-testid="chart-rows"]').dataset.rows);

describe("published measure catalogue in population views", () => {
  it("renders unseen published labels in every measure chart and legend with one colour per id", async () => {
    const fixture = measureCatalogueFixture();
    const catalogue = catalogueFor(fixture);
    const selected = [ALPHA, BETA];
    const revenue = [{ year: YEAR, netImpact: 1, ...Object.fromEntries(catalogue.displayable.map((measure) => [measure.seriesKey, measure.direction === "cost" ? -2 : 3])) }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    const { container } = render(withCatalogue(catalogue, <>
      <div data-testid="revenue"><BudgetaryImpactChart data={revenue} selectedYear={YEAR} /></div>
      <div data-testid="relative"><DistributionalChart rawData={fixture.distributional} selectedPolicies={selected} selectedYear={YEAR} /></div>
      <div data-testid="absolute"><WaterfallChart rawData={fixture.winnersLosers} selectedPolicies={selected} selectedYear={YEAR} /></div>
      <div data-testid="age"><YoungPeopleSection policies={catalogue.measures} selectedPolicies={selected} selectedYear={YEAR} /></div>
    </>));
    await screen.findByRole("heading", { name: /Average change by age/ });
    for (const chart of ["revenue", "relative", "absolute", "age"]) {
      const region = within(screen.getByTestId(chart));
      const series = region.getAllByTestId("measure-series");
      for (const measure of catalogue.displayable) {
        expect(series.find((node) => node.dataset.measure === measure.seriesKey)?.dataset.color).toBe(measure.color);
        expect(region.getAllByText(measure.label).length).toBeGreaterThan(0);
      }
      expect(region.queryByText(catalogue.byId.get(HELD).name)).not.toBeInTheDocument();
    }
    expect(container.textContent).not.toContain("999");
    expect(catalogue.combinedId).toBeNull();
  });

  it("uses published descriptions in the selector and excludes unavailable measures", () => {
    const catalogue = catalogueFor(measureCatalogueFixture());
    const toggle = vi.fn();
    render(withCatalogue(catalogue, <PolicySelector selectedPolicies={[ALPHA, BETA]} onPolicyToggle={toggle} />));
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    for (const measure of catalogue.displayable) {
      expect(screen.getByText(measure.label)).toBeInTheDocument();
      expect(screen.getByText(measure.description)).toBeInTheDocument();
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).name)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(toggle).toHaveBeenCalledWith(catalogue.displayable[0].id);
  });

  it("uses catalogue labels in household breakdowns and keeps held measures out", () => {
    const fixture = measureCatalogueFixture();
    const catalogue = catalogueFor(fixture);
    const { container } = render(withCatalogue(catalogue,
      <HouseholdChart rawData={fixture.household} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    expect(screen.getByText(/Mock alpha support:/)).toHaveStyle({ color: catalogue.byId.get(ALPHA).color });
    expect(screen.getByText(/Mock beta contribution:/)).toHaveStyle({ color: catalogue.byId.get(BETA).color });
    expect(chartRows(container)[0].x).toBe(50);
    expect(container.textContent).not.toContain("Mock held measure");
  });

  it("shows unavailable instead of a partial household total when a held id remains selected", () => {
    const fixture = measureCatalogueFixture();
    const { container } = render(withCatalogue(catalogueFor(fixture),
      <HouseholdChart rawData={fixture.household} selectedPolicies={[ALPHA, HELD]} selectedYear={YEAR} />,
    ));
    expect(screen.getByRole("status")).toHaveTextContent("A partial total is not shown");
    expect(container.querySelector('[data-testid="chart-rows"]')).toBeNull();
  });

  it.each([
    ["relative", DistributionalChart, "distributional"],
    ["absolute", WaterfallChart, "winnersLosers"],
  ])("keeps missing %s figures null and marks the net change unavailable", (_name, Chart, source) => {
    const fixture = measureCatalogueFixture({ held: false });
    const rows = fixture[source].filter((row) => row.reform_id !== BETA);
    const { container } = render(withCatalogue(catalogueFor(fixture),
      <Chart rawData={rows} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    expect(screen.getByRole("status")).toHaveTextContent("The net change is unavailable");
    const points = chartRows(container);
    expect(points.every((point) => point[`measure:${BETA}`] === null && point.netChange === null)).toBe(true);
  });

  it.each([
    ["relative", DistributionalChart, "distributional"],
    ["absolute", WaterfallChart, "winnersLosers"],
  ])("enforces unsupported years in the %s view", (_name, Chart, source) => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].unsupported_years = [YEAR];
    const catalogue = catalogueFor(fixture);
    const { container } = render(withCatalogue(catalogue, <Chart rawData={fixture[source]} selectedPolicies={[ALPHA]} selectedYear={YEAR} />));
    expect(chartRows(container).every((point) => point[`measure:${ALPHA}`] === null && point.netChange === null)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("The net change is unavailable");
  });

  it("shares the catalogue's colours between standalone legends and tooltips", () => {
    const catalogue = catalogueFor(measureCatalogueFixture());
    const { container } = render(withCatalogue(catalogue, <>
      <GroupedLegend names={catalogue.allPolicyNames} />
      <ChartTooltip active payload={catalogue.displayable.map((measure) => ({
        dataKey: measure.seriesKey, name: measure.label, value: 1, color: "wrong colour",
      }))} format={(value) => `£${value}`} />
    </>));
    for (const measure of catalogue.displayable) {
      const row = [...container.querySelectorAll(".chart-tooltip-row")].find((node) => node.textContent.includes(measure.name));
      const swatch = row.querySelector(".chart-tooltip-swatch");
      expect(swatch).toHaveStyle({ background: measure.color });
    }
    // Once in the legend and once in the tooltip (#69's legend has no
    // off-screen measuring copy)
    expect(screen.getAllByText("Raise revenue")).toHaveLength(2);
    expect(screen.getAllByText("Cost revenue")).toHaveLength(2);
  });

  it("holds the age package and its headline when the combined run is withdrawn", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = "withdrawn";
    const catalogue = catalogueFor(fixture);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    render(withCatalogue(catalogue,
      <YoungPeopleSection policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    expect(await screen.findByText(/These shares come from one simulation/)).toBeInTheDocument();
    // #69 has no headline tiles: the shares card says it has no whole run
    expect(screen.getByText(/shown for a single policy or for all policies/)).toBeInTheDocument();
    expect(screen.getAllByTestId("chart-rows")).toHaveLength(3);
  });

  it("keeps an unsupported year's age figures null and refuses the combined run", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].unsupported_years = [YEAR];
    const catalogue = catalogueFor(fixture);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    const { container } = render(withCatalogue(catalogue,
      <YoungPeopleSection policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    expect(await screen.findByText(/The net change is unavailable for those age groups/)).toBeInTheDocument();
    expect(chartRows(container).every((point) => point[`measure:${ALPHA}`] === null && point.netChange === null)).toBe(true);
    expect(screen.getByText(/These shares come from one simulation/)).toBeInTheDocument();
  });

  it("recognises an unseen combined id when every measure is displayable", () => {
    const catalogue = catalogueFor(measureCatalogueFixture({ held: false }));
    expect(catalogue.combinedId).toBe(COMBINED);
    expect(catalogue.byId.has(COMBINED)).toBe(false);
  });
});


describe("measure chart keys", () => {
  it.each(["unpublished", "incomplete", "year", "netImpact"])("keeps the published label %s independent of every chart's metadata", async (label) => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].name = label;
    const catalogue = catalogueFor(fixture);
    const measure = catalogue.byId.get(ALPHA);
    expect(measure.seriesKey).toBe(`measure:${ALPHA}`);
    const revenue = [{ year: YEAR, unpublished: false, netImpact: 2, [measure.seriesKey]: 2 }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    const { container } = render(withCatalogue(catalogue, <>
      <BudgetaryImpactChart data={revenue} selectedYear={YEAR} />
      <DistributionalChart rawData={fixture.distributional} selectedPolicies={[ALPHA]} selectedYear={YEAR} />
      <WaterfallChart rawData={fixture.winnersLosers} selectedPolicies={[ALPHA]} selectedYear={YEAR} />
      <YoungPeopleSection policies={catalogue.measures} selectedPolicies={[ALPHA]} selectedYear={YEAR} />
    </>));
    await screen.findByRole("heading", { name: /Average change by age/ });
    const series = screen.getAllByTestId("measure-series").filter((node) => node.dataset.measure === measure.seriesKey);
    expect(series).toHaveLength(4);
    expect(series.every((node) => node.dataset.label === measure.label)).toBe(true);
    const rows = [...container.querySelectorAll('[data-testid="chart-rows"]')].map((node) => JSON.parse(node.dataset.rows));
    expect(rows[0][0]).toEqual({ year: YEAR, unpublished: false, netImpact: 2, [measure.seriesKey]: 2 });
    expect(rows[1][0][measure.seriesKey]).toBe(0.5);
    expect(rows[1][0].incomplete).toBe(false);
    expect(rows[2][0][measure.seriesKey]).toBe(100);
    expect(rows[2][0].netChange).toBe(100);
    expect(rows[3][0][measure.seriesKey]).toBe(100);
    expect(rows[3][0].band).toBe("0-15");
  });

  it("preserves all age-chart metadata and individual values for arbitrary labels", () => {
    fc.assert(fc.property(
      fc.array(fc.record({ label: fc.string(), value: fc.integer({ min: -100000, max: 100000 }) }), { minLength: 1, maxLength: 15 }),
      (entries) => {
        const policies = entries.map((entry, index) => ({ id: String(index), name: entry.label, seriesKey: `measure:${index}` }));
        const rows = entries.map((entry, index) => ({ reform_id: String(index), year: YEAR, age_band: "16-24", mean_change: entry.value, sample_size: 5000 }));
        const point = meanChangeByBand(rows, policies, policies.map((policy) => policy.id), YEAR).find((candidate) => candidate.band === "16-24");
        expect(point.label).toBe("16 to 24");
        expect(point.incomplete).toBe(false);
        expect(point.suppressed).toBe(false);
        expect(point.netChange).toBe(entries.reduce((sum, entry) => sum + entry.value, 0));
        policies.forEach((policy, index) => expect(point[policy.seriesKey]).toBe(entries[index].value));
      },
    ), { numRuns: 100 });
  });

  it("groups neutral measures as Other measures in catalogue order", () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.budgetary.forEach((row) => { if (row.reform_id === ALPHA) row.value = 0; });
    const catalogue = catalogueFor(fixture);
    const { container } = render(withCatalogue(catalogue, <ChartTooltip active payload={catalogue.displayable.map((measure) => ({ dataKey: measure.seriesKey, name: "untrusted display label", value: 1 }))} format={String} />));
    const headings = [...container.querySelectorAll(".chart-tooltip-heading")].map((node) => node.textContent);
    expect(headings).toEqual(["Raise revenue", "Other measures"]);
    expect(screen.getByText(catalogue.byId.get(ALPHA).label)).toBeInTheDocument();
    expect(screen.queryByText("Cost revenue")).not.toBeInTheDocument();
  });
});

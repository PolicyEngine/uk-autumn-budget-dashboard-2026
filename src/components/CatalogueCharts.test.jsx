import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { AGE_BANDS, COMBINATION_NOT_PUBLISHED, meanChangeByBand } from "../utils/ageImpact";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BudgetaryImpactChart from "./BudgetaryImpactChart";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import YoungPeopleSection from "./YoungPeopleSection";
import GroupedLegend from "./GroupedLegend";
import ChartTooltip from "./ChartTooltip";
import PolicySelector from "./PolicySelector";
import { MeasureKeyProvider } from "./MeasureKey";
import { LOGO_ROOM as SCATTER_LOGO_ROOM } from "./HouseholdScatter";
import { chartMargin } from "../utils/chartTheme";
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
  const Chart = ({ data, margin, children }) => {
    const rows = data ?? React.Children.toArray(children).find((child) => Array.isArray(child.props?.data))?.props.data ?? [];
    return (
      <ChartData.Provider value={rows}>
        <div data-testid="chart-rows" data-rows={JSON.stringify(rows)} data-margin={JSON.stringify(margin ?? null)}>{children}</div>
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
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
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

  it("lists each published measure by its short name in one flat list, raises first, with no group labels or description, and excludes unavailable ones", () => {
    const catalogue = catalogueFor(measureCatalogueFixture());
    const toggle = vi.fn();
    render(withCatalogue(catalogue, <PolicySelector selectedPolicies={[ALPHA, BETA]} onPolicyToggle={toggle} />));
    expect(screen.getByRole("button", { name: /^Policies / })).toHaveTextContent(/Policies\s*All 2 policies/);
    fireEvent.click(screen.getByRole("button", { name: /^Policies / }));
    for (const measure of catalogue.displayable) {
      expect(screen.getByText(measure.label)).toBeInTheDocument();
      expect(screen.queryByText(measure.description)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Raises revenue")).toBeNull();
    expect(screen.queryByText("Costs revenue")).toBeNull();
    expect(document.querySelector(".policy-group")).toBeNull();
    // Raises revenue first, then costs, in the catalogue's order
    const order = (measure) => ["revenue", "cost", "neutral"].indexOf(measure.direction);
    const expected = [...catalogue.displayable].sort((a, b) => order(a) - order(b)).map((m) => m.label);
    expect([...document.querySelectorAll(".policy-selector-name")].map((node) => node.textContent)).toEqual(expected);
    expect(screen.queryByText(catalogue.byId.get(HELD).name)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(toggle).toHaveBeenCalledWith(catalogue.displayable[0].id);
  });

  it("closes on Escape and puts focus back on the pill when it was in the menu", () => {
    const catalogue = catalogueFor(measureCatalogueFixture());
    render(withCatalogue(catalogue, <PolicySelector selectedPolicies={[ALPHA, BETA]} onPolicyToggle={vi.fn()} />));
    const pill = screen.getByRole("button", { name: /^Policies / });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    screen.getAllByRole("checkbox")[0].focus();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill).toHaveFocus();
  });

  it("never shows 0 of 0: while loading, the label alone; with none published, disabled", () => {
    const empty = catalogueFor({ ...measureCatalogueFixture(), manifest: null });
    const { unmount } = render(withCatalogue(empty, <PolicySelector policies={[]} selectedPolicies={[]} onPolicyToggle={vi.fn()} loading />));
    const loading = screen.getByRole("button", { name: "Policies: loading" });
    expect(loading).toHaveTextContent("Policies");
    expect(loading).not.toHaveTextContent(/0 of 0/);
    expect(loading).toBeDisabled();
    unmount();
    render(withCatalogue(empty, <PolicySelector policies={[]} selectedPolicies={[]} onPolicyToggle={vi.fn()} noneReason="No Budget results are published yet" />));
    const none = screen.getByRole("button", { name: "No policies yet: No Budget results are published yet" });
    expect(none).toHaveTextContent("No policies yet");
    expect(none).toBeDisabled();
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

  it.each([
    ["relative", DistributionalChart, "distributional", "value", -1, /; in 2030-31 both lose\.$/],
    ["absolute", WaterfallChart, "winnersLosers", "avg_change", -500, /; in 2030-31 both lose\.$/],
  ])("points the %s view to a later year in which the ends turn", (_name, Chart, source, key, later, note) => {
    const fixture = measureCatalogueFixture({ held: false });
    // The same rows a year on, with the first measure turned to a loss
    const next = fixture[source].map((row) => ({ ...row, year: YEAR + 1, ...(row.reform_id === ALPHA ? { [key]: later } : {}) }));
    const { container, unmount } = render(withCatalogue(catalogueFor(fixture),
      <Chart rawData={[...fixture[source], ...next]} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    // The turn is the decile sentence's last clause
    expect(container.querySelector(".chart-description").textContent).toMatch(note);
    unmount();
    // The same rows in both years: no turn, no pointer
    const same = render(withCatalogue(catalogueFor(fixture),
      <Chart rawData={[...fixture[source], ...fixture[source].map((row) => ({ ...row, year: YEAR + 1 }))]} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    expect(same.container.querySelector(".chart-description").textContent).not.toMatch(/; in \d/);
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
      // A measure's row shows its category icon tile in the catalogue colour
      const tile = row.querySelector(".mrl-icon");
      expect(tile.style.getPropertyValue("--mrl-colour")).toBe(measure.color);
    }
    expect(screen.getAllByText("Raise revenue")).toHaveLength(2);
    expect(screen.getAllByText("Cost revenue")).toHaveLength(2);
  });

  it("holds the age package shares when the combined run is withdrawn", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = "withdrawn";
    const catalogue = catalogueFor(fixture);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    const { container } = render(withCatalogue(catalogue,
      <YoungPeopleSection policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    // The withdrawn package is never drawn: the shares card shows each
    // measure's own run, one row per measure, and says so
    expect(await screen.findByText(/each selected policy on its own/)).toBeInTheDocument();
    expect(screen.queryByText(/directly affected:/)).not.toBeInTheDocument();
    const shares = container.querySelector(".young-people-shares");
    expect(shares.querySelector('[data-testid="chart-rows"]')).toBeNull();
    const names = [...shares.querySelectorAll(".msc [role='rowheader']")].map((node) => node.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => [catalogue.byId.get(ALPHA), catalogue.byId.get(BETA)].some((m) => [m.label, m.name].includes(name)))).toBe(true);
    // the average change and trend cards still chart (the measures card is a
    // dumbbell, not a chart, since #128)
    expect(screen.getAllByTestId("chart-rows")).toHaveLength(2);
  });

  it("keeps an unsupported year's age figures null and refuses the combined run", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].unsupported_years = [YEAR];
    const catalogue = catalogueFor(fixture);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
    const { container } = render(withCatalogue(catalogue,
      <YoungPeopleSection policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />,
    ));
    // Two policies, one with no figures this year: not published together,
    // never half drawn
    expect((await screen.findAllByText(COMBINATION_NOT_PUBLISHED)).length).toBeGreaterThan(0);
    expect(chartRows(container).every((point) => point[`measure:${ALPHA}`] == null && point.netChange == null)).toBe(true);
    // The combined run is refused: no package shares, only each measure's own
    expect(screen.getByText(/each selected policy on its own/)).toBeInTheDocument();
    const shares = container.querySelector(".young-people-shares");
    const names = [...shares.querySelectorAll(".msc [role='rowheader']")].map((node) => node.getAttribute("aria-label"));
    const alpha = catalogue.byId.get(ALPHA);
    // Alpha has no supported figures this year, so it draws no row
    expect(names.some((name) => [alpha.label, alpha.name].includes(name))).toBe(false);
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
        // Every band published (£0 outside 16 to 24), as a complete publication is
        const rows = entries.flatMap((entry, index) => AGE_BANDS.map((band) => ({ reform_id: String(index), year: YEAR, age_band: band.key, mean_change: band.key === "16-24" ? entry.value : 0, sample_size: 5000 })));
        const point = meanChangeByBand(rows, policies, policies.map((policy) => policy.id), YEAR).find((candidate) => candidate.band === "16-24");
        expect(point.label).toBe("16 to 24");
        expect(point.incomplete).toBe(false);
        expect(point.suppressed).toBe(false);
        expect(point.netChange).toBe(entries.reduce((sum, entry) => sum + entry.value, 0));
        policies.forEach((policy, index) => expect(point[policy.seriesKey]).toBe(entries[index].value));
      },
    ), { numRuns: 100 });
  });

  it("never renders a held measure in age means, even if stale rows remain", () => {
    fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), (value) => {
      const policy = { id: "held", seriesKey: "measure:held", name: "Held", displayable: false };
      const rows = [{ reform_id: policy.id, year: YEAR, age_band: "16-24", mean_change: value, sample_size: 5000 }];
      const point = meanChangeByBand(rows, [policy], [policy.id], YEAR).find((candidate) => candidate.band === "16-24");
      expect(point[policy.seriesKey]).toBeNull();
      expect(point.netChange).toBeNull();
      expect(point.incomplete).toBe(true);
    }));
  });

  it("groups neutral measures as Other measures in catalogue order", () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.budgetary.forEach((row) => { if (row.reform_id === ALPHA) row.value = 0; });
    const catalogue = catalogueFor(fixture);
    const { container } = render(withCatalogue(catalogue, <ChartTooltip active payload={catalogue.displayable.map((measure) => ({ dataKey: measure.seriesKey, name: "untrusted display label", value: 1 }))} format={String} />));
    const headings = [...container.querySelectorAll(".chart-tooltip-heading")].map((node) => node.textContent);
    expect(headings).toEqual(["Raise revenue", "Other policies"]);
    expect(screen.getByText(catalogue.byId.get(ALPHA).label)).toBeInTheDocument();
    expect(screen.queryByText("Cost revenue")).not.toBeInTheDocument();
  });
});

// All households' By income pair: the decile card (either view) beside the
// household scatter. Both draw their logo in the SVG under the same axis
// margins, so the plots, axis titles and logos sit level (HouseholdScatter
// .test.jsx checks the scatter's side).
describe("income decile card beside the household scatter", () => {
  it("draws both decile views with the scatter's top margin and logo room under the axis", () => {
    const fixture = measureCatalogueFixture();
    const catalogue = catalogueFor(fixture);
    const selected = [ALPHA, BETA];
    render(withCatalogue(catalogue, (
      <MeasureKeyProvider>
        <div data-testid="relative"><DistributionalChart rawData={fixture.distributional} selectedPolicies={selected} selectedYear={YEAR} /></div>
        <div data-testid="absolute"><WaterfallChart rawData={fixture.winnersLosers} selectedPolicies={selected} selectedYear={YEAR} /></div>
      </MeasureKeyProvider>
    )));
    expect(SCATTER_LOGO_ROOM).toBe(31);
    for (const chart of ["relative", "absolute"]) {
      const margin = JSON.parse(within(screen.getByTestId(chart)).getByTestId("chart-rows").dataset.margin);
      expect(margin.top).toBe(chartMargin(false).top);
      expect(margin.bottom).toBe(SCATTER_LOGO_ROOM);
    }
  });
});

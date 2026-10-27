import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AgeSection from "../AgeSection";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { COMBINATION_NOT_PUBLISHED, PACKAGE_NET_ONLY, PACKAGE_PARTS_CAVEAT, singleAgeSelection } from "../../utils/ageImpact";
import { singleAgeBars } from "../youngPeople/youngPeopleData";
import { ALPHA, BETA, COMBINED, YEAR, measureCatalogueFixture } from "../../test/measureCatalogueFixture";

// By age's selection rule, on a publication where one single (BETA)
// withholds its age bands (too few survey records), keeping all ages, as
// the State Pension income tax protection does from 2027-28:
// - the published package of exactly the selection reads its own rows;
// - another combination is not published by age, never half drawn;
// - the single alone draws what it has and says what it withholds.
vi.setConfig({ testTimeout: 30000 });

vi.mock("recharts", async () => {
  const React = await import("react");
  const Chart = ({ data, children }) => {
    const rows = data ?? [];
    return <div data-testid="chart-rows" data-rows={JSON.stringify(rows)}>{children}</div>;
  };
  const Bar = ({ dataKey, hide }) => (hide ? null : <span data-testid="series" data-key={dataKey} />);
  const Empty = () => null;
  return {
    ComposedChart: Chart, BarChart: Chart, ScatterChart: Chart, LineChart: Chart,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    Bar, Scatter: Empty, Cell: Empty, Tooltip: Empty, Legend: Empty,
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty,
    ReferenceArea: Empty, ReferenceLine: Empty, LabelList: Empty, Customized: Empty,
  };
});
vi.mock("../ChartDownloadMenu", () => ({ default: () => null }));
vi.mock("../../utils/loadDashboard", async (importOriginal) => {
  const actual = await importOriginal();
  const { parseTable } = await import("../../utils/publication/csv");
  const { isCatalogueRowDisplayable } = await import("../../utils/measureCatalogue");
  return {
    ...actual,
    peekVerifiedTables: () => null,
    loadVerifiedTable: async (catalogue, table) => {
      const response = await fetch(`/data/${table}.csv`);
      return parseTable(table, await response.text()).filter((row) =>
        isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
      );
    },
  };
});
vi.mock("../../utils/chartLogo", () => ({
  PolicyEngineLogo: () => null,
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BANDS = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+"];

/** The fixture with BETA's age bands withheld: its all ages row stays. */
function withheldFixture({ packagePublished = true } = {}) {
  const fixture = measureCatalogueFixture({ held: false });
  if (!packagePublished) fixture.manifest.combined[COMBINED].status = "withdrawn";
  const [header, ...lines] = fixture.ageCsv.split("\n");
  const kept = lines.filter((line) => {
    const [id, , , band] = line.split(",");
    return !(id === BETA && BANDS.includes(band));
  });
  fixture.ageCsv = [header, ...kept].join("\n");
  return fixture;
}

async function renderAge(fixture, selectedPolicies) {
  const catalogue = buildMeasureCatalogue(fixture);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => fixture.ageCsv })));
  const view = render(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <AgeSection policies={catalogue.measures} selectedPolicies={selectedPolicies} selectedYear={YEAR} />
    </MeasureCatalogueProvider>,
  );
  await screen.findByRole("heading", { name: /Average change by age/ });
  return { ...view, catalogue };
}

const chartRows = (container) =>
  [...container.querySelectorAll('[data-testid="chart-rows"]')].map((node) => JSON.parse(node.dataset.rows));

/** No chart draws some of its points and not others in the selected year. */
function expectNoHalfDrawn(container) {
  for (const rows of chartRows(container)) {
    const points = rows.filter((point) => point.year === undefined || point.year === YEAR);
    for (const key of ["netChange", ...BANDS, "all"]) {
      const present = points.filter((point) => key in point);
      if (present.length < 2) continue;
      const drawn = present.filter((point) => point[key] !== null && point[key] !== undefined);
      expect([0, present.length], `${key} drawn at ${drawn.length} of ${present.length} points`).toContain(drawn.length);
    }
  }
}

/** By age's "Average change by age" card. */
const meanCard = (container) => container.querySelector(".young-people-mean");

describe("By age's selection rule with a single that withholds its age bands", () => {
  it("reads the published package's own rows: every band drawn, no withheld note", async () => {
    const { container } = await renderAge(withheldFixture(), [ALPHA, BETA]);
    expect(screen.queryByText(COMBINATION_NOT_PUBLISHED)).toBeNull();
    expect(container.textContent).not.toMatch(/Not drawn in/);
    expect(container.textContent).not.toMatch(/no published results by age/);
    // Average change by age: the package's net (50) in every band, and no
    // stack of the singles under it
    const bands = chartRows(container).find((rows) => rows.some((point) => point.band === "16-24"));
    expect(bands.map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    expect(bands.every((point) => point[`measure:${ALPHA}`] === null)).toBe(true);
    // Average change by age: no note on the card, a one-line subtitle, the
    // reason in About this chart's caveats, and no By policy option
    const card = meanCard(container);
    expect(within(card).queryByText(PACKAGE_NET_ONLY)).toBeNull();
    expect(within(card).getByText("Average change per person, £ a year, with all the selected policies.")).toBeInTheDocument();
    expect(card.querySelector(".chart-footer .note, .chart-footer [class*='note']")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    expect(await within(card).findByText(PACKAGE_PARTS_CAVEAT)).toBeInTheDocument();
    const pill = within(card).queryByRole("button", { name: /^Options:/ });
    if (pill) {
      fireEvent.click(pill);
      expect(within(card).queryByRole("radio", { name: "By policy" })).toBeNull();
    }
    // Change by year: every group drawn in the published year
    const trend = chartRows(container).find((rows) => rows.some((point) => point.year === YEAR && "all" in point));
    const year = trend.find((point) => point.year === YEAR);
    for (const key of [...BANDS, "all"]) expect(year[key]).toBe(50);
    expect(document.querySelector(".young-people-trend .trend-headline")).toHaveTextContent(/gain about £50/);
    expectNoHalfDrawn(container);
  });

  it("shows another combination as not published by age, never half drawn", async () => {
    const { container } = await renderAge(withheldFixture({ packagePublished: false }), [ALPHA, BETA]);
    expect(screen.getAllByText(COMBINATION_NOT_PUBLISHED).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/Not drawn in/);
    for (const rows of chartRows(container)) {
      for (const point of rows) {
        for (const key of ["netChange", ...BANDS, "all"]) expect(point[key] ?? null).toBeNull();
      }
    }
    expectNoHalfDrawn(container);
  });

  it("draws the single alone with what it has, and says what it withholds", async () => {
    const { container } = await renderAge(withheldFixture(), [BETA]);
    expect(screen.queryByText(COMBINATION_NOT_PUBLISHED)).toBeNull();
    const trend = chartRows(container).find((rows) => rows.some((point) => point.year === YEAR && "all" in point));
    expect(trend.find((point) => point.year === YEAR).all).toBe(-50);
    // No note under any plot: the reason sits in About this chart's caveats
    expect(container.querySelector(".chart-footer .note")).toBeNull();
    const trendCard = container.querySelector(".young-people-trend");
    expect(trendCard.textContent).not.toMatch(/Not drawn in/);
    fireEvent.click(within(trendCard).getByRole("button", { name: /About this chart/ }));
    expect(trendCard.textContent).toMatch(/Not drawn in .*, as a selected policy has too few survey records by age/);
  });

  it("applies the same rule to single years of age", () => {
    const policies = [{ id: "a" }, { id: "b" }];
    const rows = [
      ...[10, 11, 12].map((age) => ({ reform_id: "a", year: YEAR, age_band: String(age), mean_change: 10, sample_size: 500 })),
      { reform_id: "b", year: YEAR, age_band: "10", mean_change: 5, sample_size: 500 },
      ...[10, 11, 12].map((age) => ({ reform_id: "pkg", year: YEAR, age_band: String(age), mean_change: 14, sample_size: 500 })),
    ];
    const bars = singleAgeBars(rows, policies, ["a", "b"], YEAR, 10, 12);
    const fromPackage = singleAgeSelection(bars, { rows, policies, selected: ["a", "b"], year: YEAR, packageRun: "pkg" });
    expect(fromPackage.map((point) => point.netChange)).toEqual([14, 14, 14]);
    expect(fromPackage.every((point) => point.parts.length === 0 && !point.partsShown)).toBe(true);
    const combination = singleAgeSelection(bars, { rows, policies, selected: ["a", "b"], year: YEAR });
    expect(combination.every((point) => point.netChange === null && point.combinationUnavailable)).toBe(true);
    const alone = singleAgeSelection(singleAgeBars(rows, policies, ["b"], YEAR, 10, 12), { rows, policies, selected: ["b"], year: YEAR });
    expect(alone.map((point) => point.netChange)).toEqual([5, null, null]);
  });
});

describe("Average change by age with a package whose every member has rows by age", () => {
  it("shows the package's own bars, with each policy's part offered as By policy", async () => {
    const { container } = await renderAge(measureCatalogueFixture({ held: false }), [ALPHA, BETA]);
    const card = meanCard(container);
    const bandRows = () => chartRows(card).find((rows) => rows.some((point) => point.band === "16-24"));
    // By default: the package's own net, no policy parts
    expect(bandRows().map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    expect(bandRows().every((point) => point[`measure:${ALPHA}`] === null)).toBe(true);
    expect(within(card).getByText("Average change per person, £ a year, with all the selected policies.")).toBeInTheDocument();
    expect(within(card).queryByText(PACKAGE_NET_ONLY)).toBeNull();
    // By policy: each policy's own rows stacked under the package's net
    fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(card).getByRole("radio", { name: "By policy" }));
    expect(bandRows().map((point) => point[`measure:${ALPHA}`])).toEqual(BANDS.map(() => 100));
    expect(bandRows().map((point) => point[`measure:${BETA}`])).toEqual(BANDS.map(() => -50));
    expect(bandRows().map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    expect(within(card).getByRole("button", { name: /^Options:.*By policy/ })).toBeInTheDocument();
    // No caveat: nothing is withheld
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    expect(within(card).queryByText(PACKAGE_PARTS_CAVEAT)).toBeNull();
  });
});

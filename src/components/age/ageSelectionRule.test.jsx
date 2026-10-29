import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AgeSection from "../AgeSection";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { COMBINATION_NOT_PUBLISHED, PACKAGE_NET_ONLY, PACKAGE_PARTS_CAVEAT, policiesWithoutRows, singleAgeSelection, withheldNetOnly } from "../../utils/ageImpact";
import { singleAgeBars } from "../youngPeople/youngPeopleData";
import { agesText, windowTicks, withheldPartsCaveat } from "./SingleAgeCard";
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

/** By age's "Average change by age" card, switched to its Age groups view (single years by default). */
function meanCard(container) {
  const shown = container.querySelector(".young-people-mean");
  if (shown) return shown;
  const single = container.querySelector(".single-age-card");
  fireEvent.click(within(single).getByRole("button", { name: /^Options:/ }));
  fireEvent.click(within(single).getByRole("radio", { name: "Age groups" }));
  return container.querySelector(".young-people-mean");
}

/** The fixture with single-year rows 0 to 90+ for each key, less `without`'s. */
function withSingleAges(fixture, without = null) {
  const lines = [ALPHA, BETA, COMBINED].filter((id) => id !== without).flatMap((id) =>
    Array.from({ length: 91 }, (_, age) =>
      [id, id, YEAR, age === 90 ? "90+" : String(age), 10_000, 500, id === ALPHA ? 100 : id === BETA ? -50 : 50, 25, 20, 30, 50, 2_000].join(","),
    ),
  );
  return { ...fixture, ageCsv: [fixture.ageCsv, ...lines].join("\n") };
}

describe("By age's selection rule with a single that withholds its age bands", () => {
  it("reads the published package's own rows: every band drawn, no withheld note", async () => {
    const { container } = await renderAge(withheldFixture(), [ALPHA, BETA]);
    meanCard(container);
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
    expect(within(card).getByText("Average change in household income per person, £ a year, with all the selected policies.")).toBeInTheDocument();
    expect(card.querySelector(".chart-footer .note, .chart-footer [class*='note']")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    // The caveat names the policy that withholds its rows by age group
    expect(await within(card).findByText(withheldPartsCaveat(["Mock beta contribution"], "in some age groups"))).toBeInTheDocument();
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
  it("opens on By policy, each policy's part stacked under the package's net, and keeps the reader's choice", async () => {
    const { container } = await renderAge(measureCatalogueFixture({ held: false }), [ALPHA, BETA]);
    const card = meanCard(container);
    const bandRows = () => chartRows(container.querySelector(".young-people-mean")).find((rows) => rows.some((point) => point.band === "16-24"));
    // By default (Vahid, 29 October): each policy's own rows stacked under the package's net
    expect(bandRows().map((point) => point[`measure:${ALPHA}`])).toEqual(BANDS.map(() => 100));
    expect(bandRows().map((point) => point[`measure:${BETA}`])).toEqual(BANDS.map(() => -50));
    expect(bandRows().map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    // By policy is the default, so the pill does not name it
    expect(within(card).getByRole("button", { name: /^Options:/ }).getAttribute("aria-label") ?? "").not.toMatch(/By policy/);
    fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
    expect(within(card).getByRole("radio", { name: "By policy" })).toHaveAttribute("aria-checked", "true");
    // All selected policies: the package's own net, no policy parts
    fireEvent.click(within(card).getByRole("radio", { name: "All selected policies" }));
    expect(bandRows().map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    expect(bandRows().every((point) => point[`measure:${ALPHA}`] === null)).toBe(true);
    expect(within(card).getByText("Average change in household income per person, £ a year, with all the selected policies.")).toBeInTheDocument();
    expect(within(card).queryByText(PACKAGE_NET_ONLY)).toBeNull();
    expect(within(card).getByRole("button", { name: /^Options:.*All selected policies/ })).toBeInTheDocument();
    // No caveat: nothing is withheld
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    expect(within(card).queryByText(PACKAGE_PARTS_CAVEAT)).toBeNull();
  });

  it("keeps the reader's Policies choice across a switch to single years and back", async () => {
    const { container } = await renderAge(withSingleAges(measureCatalogueFixture({ held: false })), [ALPHA, BETA]);
    const card = meanCard(container);
    fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(card).getByRole("radio", { name: "All selected policies" }));
    const again = container.querySelector(".young-people-mean");
    if (!within(again).queryByRole("radio", { name: "Single year of age" })) fireEvent.click(within(again).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(again).getByRole("radio", { name: "Single year of age" }));
    const back = meanCard(container);
    fireEvent.click(within(back).getByRole("button", { name: /^Options:/ }));
    expect(within(back).getByRole("radio", { name: "All selected policies" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Average change by age by single year of age (the default view)", () => {
  const singleCard = (container) => container.querySelector(".single-age-card");
  const ageRows = (card) => chartRows(card).find((rows) => rows.some((point) => point.label === "20"));

  it("opens on single years, with each policy's part offered as By policy when every member has rows", async () => {
    const { container } = await renderAge(withSingleAges(measureCatalogueFixture({ held: false })), [ALPHA, BETA]);
    const card = singleCard(container);
    expect(card).not.toBeNull();
    expect(container.querySelector(".young-people-mean")).toBeNull();
    expect(ageRows(card).every((point) => point.netChange === 50)).toBe(true);
    fireEvent.click(within(card).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(card).getByRole("radio", { name: "Each policy" }));
    expect(within(card).getAllByTestId("series").map((node) => node.dataset.key).sort()).toEqual([`measure:${ALPHA}`, `measure:${BETA}`]);
  });

  it("drops the Show choice when a member withholds its single years, giving the reason in About this chart", async () => {
    const { container } = await renderAge(withSingleAges(withheldFixture(), BETA), [ALPHA, BETA]);
    const card = singleCard(container);
    // The package's own net at every age, never its parts
    expect(ageRows(card).every((point) => point.netChange === 50 && (point[`measure:${ALPHA}`] ?? null) === null)).toBe(true);
    // One usable option reads as broken (team feedback, 28 October): no Show
    // group, and the pill does not say "Net change" when there is no choice
    const pill = within(card).getByRole("button", { name: /^Options:/ });
    expect(pill.getAttribute("aria-label") ?? pill.textContent).not.toMatch(/Net change/);
    fireEvent.click(pill);
    expect(within(card).queryByRole("radio", { name: "Each policy" })).toBeNull();
    expect(within(card).queryByRole("radio", { name: "Net change" })).toBeNull();
    expect(within(card).queryByText(/^Each policy:/)).toBeNull();
    expect(within(card).getByRole("radio", { name: "Age groups" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    expect(await within(card).findByText(withheldPartsCaveat(["Mock beta contribution"]))).toBeInTheDocument();
    // No part drawn, not even the policy with rows: beside the package's
    // net, it would give the withheld policy's part back by difference
    expect(within(card).getAllByTestId("series").map((node) => node.dataset.key)).toEqual(["netChange"]);
  });

  it("leaves out the package's ages a member withholds, saying so, never as no change (issue 340)", async () => {
    // BETA leaves out ages 20 and 21, and so does the package
    const fixture = withSingleAges(measureCatalogueFixture({ held: false }));
    const [header, ...lines] = fixture.ageCsv.split("\n");
    const kept = lines.filter((line) => {
      const [id, , , band] = line.split(",");
      return !((id === BETA || id === COMBINED) && ["20", "21"].includes(band));
    });
    const { container } = await renderAge({ ...fixture, ageCsv: [header, ...kept].join("\n") }, [ALPHA, BETA]);
    const card = singleCard(container);
    const points = chartRows(card).find((rows) => rows.some((point) => point.label === "22"));
    const net = Object.fromEntries(points.map((point) => [point.label, point.netChange]));
    expect([net["20"], net["21"], net["22"]]).toEqual([null, null, 50]);
    // Never drawn as a member's part beside the package's net
    expect(points.every((point) => (point[`measure:${ALPHA}`] ?? null) === null)).toBe(true);
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    expect(card.textContent).toMatch(/Not shown, as too few survey records: ages 20, 21\./);
  });

  it("lists no policy as having no effect when it draws the package's net alone", async () => {
    // The bars show the package's gains, so no policy is "no change for the
    // households shown" (Vahid, 28 October: 16 to 24 in 2031-32 listed all 8)
    const { container } = await renderAge(withSingleAges(withheldFixture(), BETA), [ALPHA, BETA]);
    const card = singleCard(container);
    fireEvent.click(within(card).getByRole("button", { name: /About this chart/ }));
    await within(card).findByText(withheldPartsCaveat(["Mock beta contribution"]));
    expect(card.querySelectorAll("[data-zero-measure]")).toHaveLength(0);
    expect(within(card).queryByText(/No effect on household incomes/)).toBeNull();
  });

  it("names the withheld policy in Change by year's Policies view, drawing no parts", async () => {
    const { container } = await renderAge(withheldFixture(), [ALPHA, BETA]);
    const trend = container.querySelector(".young-people-trend");
    fireEvent.click(within(trend).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(trend).getByRole("radio", { name: /^Policies,/ }));
    expect(within(trend).queryAllByTestId("series").map((node) => node.dataset.key)).not.toContain(`measure:${ALPHA}`);
    fireEvent.click(within(trend).getByRole("button", { name: /About this chart/ }));
    expect(await within(trend).findByText(withheldNetOnly(["Mock beta contribution"]))).toBeInTheDocument();
  });
});

describe("Average change by age when the package withholds every single age", () => {
  // The members have single years, the package none (a package withholds
  // what its members withhold, #347); `bands` keeps or drops its age bands
  function packageWithoutSingleAges({ bands = true } = {}) {
    const fixture = withSingleAges(measureCatalogueFixture({ held: false }), COMBINED);
    if (bands) return fixture;
    const [header, ...lines] = fixture.ageCsv.split("\n");
    const kept = lines.filter((line) => {
      const [id, , , band] = line.split(",");
      return !(id === COMBINED && BANDS.includes(band));
    });
    return { ...fixture, ageCsv: [header, ...kept].join("\n") };
  }

  it("falls back to the age bands, with no note, and Options shows Age groups chosen", async () => {
    const { container } = await renderAge(packageWithoutSingleAges(), [ALPHA, BETA]);
    expect(container.querySelector(".single-age-card")).toBeNull();
    const card = container.querySelector(".young-people-mean");
    expect(card).not.toBeNull();
    // No note on the card (Vahid, 29 October)
    expect(card.querySelector(".note")).toBeNull();
    expect(card.textContent).not.toMatch(/Single ages not published/);
    expect(card.textContent).not.toMatch(/Not shown: too few survey records at every age/);
    // The package's own net in every band
    const bands = chartRows(card).find((rows) => rows.some((point) => point.band === "16-24"));
    expect(bands.map((point) => point.netChange)).toEqual(BANDS.map(() => 50));
    const pill = within(card).getByRole("button", { name: /^Options:/ });
    expect(pill.getAttribute("aria-label") ?? pill.textContent).toMatch(/Age groups/);
    fireEvent.click(pill);
    expect(within(card).getByRole("radio", { name: "Age groups" })).toHaveAttribute("aria-checked", "true");
    const single = within(card).getByRole("radio", { name: "Single year of age" });
    expect(single).toBeDisabled();
    expect(single).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(single);
    expect(container.querySelector(".single-age-card")).toBeNull();
    // No explanation line, no confidentiality wording anywhere on the card
    expect(card.querySelector(".control-bar-note")).toBeNull();
    expect(container.querySelector(".young-people-mean").textContent).not.toMatch(/confidential|not published for this selection/i);
  });

  it("keeps the single-age view for a policy alone that has its single ages", async () => {
    const { container } = await renderAge(packageWithoutSingleAges(), [ALPHA]);
    const card = container.querySelector(".single-age-card");
    expect(card).not.toBeNull();
    expect(container.querySelector(".young-people-mean")).toBeNull();
  });

  it("says not shown where the package withholds its bands too", async () => {
    const { container } = await renderAge(packageWithoutSingleAges({ bands: false }), [ALPHA, BETA]);
    const card = container.querySelector(".single-age-card");
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/Not shown: too few survey records at every age from 16 to 24\./);
    expect(container.querySelector(".young-people-mean")).toBeNull();
  });
});

describe("The single-year age axis", () => {
  it("names every withheld policy in one list", () => {
    expect(withheldPartsCaveat(["A", "B", "C"])).toMatch(/: A, B and C have too few survey records at some ages, so the other policies' parts would reveal theirs\.$/);
    expect(withheldPartsCaveat(["A"])).toMatch(/: A has too few/);
  });

  it("ticks every five years to 90+ on a wide screen and every ten on a phone, with no State Pension age tick", () => {
    expect(windowTicks([0, 90], [], false)).toEqual([...Array.from({ length: 18 }, (_, i) => String(i * 5)), "90+"]);
    expect(windowTicks([0, 90], [], true)).toEqual(["0", "10", "20", "30", "40", "50", "60", "70", "80", "90+"]);
    expect(windowTicks([55, 90], [], false)).toEqual(["55", "60", "65", "70", "75", "80", "85", "90+"]);
  });

  it("drops a five-year tick too close to the group's ends", () => {
    expect(windowTicks([6, 34], [16, 24], false)).toEqual(["6", "10", "16", "20", "24", "30", "34"]);
  });

  it("covers only the group's own ages (16 to 24 is 16 to 24, not 6 to 34)", () => {
    expect(windowTicks([16, 24], [], false)).toEqual(["16", "20", "24"]);
    expect(agesText([16, 24])).toBe("16 to 24");
    expect(agesText([67, 90])).toBe("67 to 90 and over");
  });

  it("says in one sentence why the split by policy is not shown, naming the thin policies", () => {
    expect(withheldPartsCaveat(["A"])).toBe(
      "The split by policy is not shown for this selection: A has too few survey records at some ages, so the other policies' parts would reveal its part.",
    );
    expect(withheldPartsCaveat(["A"], "in some age groups")).toMatch(/A has too few survey records in some age groups, so/);
    expect(withheldPartsCaveat([])).toBe(PACKAGE_PARTS_CAVEAT);
    expect(PACKAGE_PARTS_CAVEAT).toMatch(/a selected policy has too few survey records at some ages/);
    expect(withheldNetOnly(["A"])).toMatch(/as A has too few survey records by age, and showing only the other policies/);
    expect(withheldNetOnly([])).toBe(PACKAGE_NET_ONLY);
  });

  it("finds the selected policies that withhold a row the chart reads", () => {
    const policies = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "held", displayable: false }];
    const rows = [
      ...["16", "17"].map((age) => ({ reform_id: "a", year: YEAR, age_band: age, mean_change: 1, sample_size: 500 })),
      { reform_id: "b", year: YEAR, age_band: "16", mean_change: 1, sample_size: 500 },
      ...["16", "17"].map((age) => ({ reform_id: "c", year: YEAR, age_band: age, mean_change: 1, sample_size: 50 })),
    ];
    const ids = (selected, years = [YEAR]) => policiesWithoutRows(rows, policies, selected, years, ["16", "17"]).map((policy) => policy.id);
    expect(ids(["a", "b", "c", "held"])).toEqual(["b", "c"]);
    expect(ids(["a"])).toEqual([]);
    // A year with no rows at all is not published, not withheld
    expect(ids(["a", "b"], [YEAR + 1])).toEqual([]);
  });
});

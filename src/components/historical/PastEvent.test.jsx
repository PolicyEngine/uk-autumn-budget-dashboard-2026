import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoveragePanel, formatBn, loadHistoricalViews } from "./PastEvent";
import { dynamicParams, generateMetadata, generateStaticParams } from "../../app/budgets/[release]/page";
import HistoricalReleases from "../../app/budgets/page";
import { coverageOf, releaseFixtureFetch, toCsv } from "../../test/historicalFixture";
import { fixtureJson, IN_DATA } from "../../test/publicationFixture";
import { COVERAGE_HEADER, coverageProblems, NOT_MODELLED_HEADER, OBR_HEADER, fraction, parseCoverage } from "../../utils/historical";
import { CURRENT_BUDGET, HISTORICAL_RELEASES } from "../../utils/publication/release";
import { loadDashboard } from "../../utils/loadDashboard";

// Synthetic flat views for the publication fixture, served as a past
// event's release. Test data only; never real figures.
const RELEASE = HISTORICAL_RELEASES[0];
const PAGE_IDS = Object.keys(fixtureJson("manifest.json").measures);
const cell = (pounds, places = 0) => ({ classification: "partial", gap: null, value: fraction(BigInt(pounds), 10n ** BigInt(places)), constructed: true });
const MEASURES = [
  ...PAGE_IDS.map((id, index) => ({ id, classification: "partial", gap: "model_or_data_gap", computed: true, rows: [cell(1_000_000_000 * (index + 1)), { ...cell(-250_000_000), classification: "out_of_household_scope", constructed: false }] })),
  { id: "n1", classification: "not_expressible", gap: "construction_pending", computed: false, rows: [{ ...cell(400_000_000), classification: "not_expressible", constructed: false }] },
  { id: "n2", classification: "not_expressible", gap: "model_or_data_gap", computed: false, rows: [{ ...cell(-3_000_000_005, 1), classification: "not_expressible", constructed: false }] },
  { id: "n3", classification: "out_of_household_scope", gap: null, computed: false, rows: [{ ...cell(9_000_000_000), classification: "out_of_household_scope", constructed: false }] },
];
const NOT_MODELLED = [
  ["n1", "Levy on widgets", "not_expressible", "construction_pending", "No construction has been established.", 1, "400000000"],
  ["n2", "Relief for gadgets", "not_expressible", "model_or_data_gap", "The data has no gadgets.", 1, "300000000.5"],
  ["n3", "Capital spending", "out_of_household_scope", "", "Departmental spending.", 1, "9000000000"],
];
const PAIR = "policyengine-uk 2.130.1, synthetic.h5 at revision 1.0.0";
const OBR = [
  ["alpha", "Alpha", String(IN_DATA), "2500000000", "2000000000", "1900000000", PAIR],
  ["beta", "Beta", String(IN_DATA), "-1000000000", "-800000000", "", PAIR],
];
const FLAT = {
  "coverage.csv": coverageOf(MEASURES),
  "not_modelled.csv": toCsv(NOT_MODELLED_HEADER, NOT_MODELLED),
  "obr_comparison.csv": toCsv(OBR_HEADER, OBR),
};

let fetchImpl;
async function serve(options = {}) {
  fetchImpl = await releaseFixtureFetch(RELEASE, { flat: FLAT, ...options });
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
}

beforeEach(async () => {
  await serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The past event's sections as the dashboard shows them are tested with
// the dashboard (src/AppReleases.test.jsx); these are its loaders, panels
// and routes on their own

describe("the flat views are checked against each other", () => {
  const catalogueFor = async (flat) => {
    const fetchFor = await releaseFixtureFetch(RELEASE, { flat });
    vi.stubGlobal("fetch", vi.fn(fetchFor));
    return (await loadDashboard("", { fetchImpl: fetchFor, release: RELEASE })).catalogue;
  };

  it("are all shown when they agree", async () => {
    const views = await loadHistoricalViews(await catalogueFor(FLAT));
    expect(Object.values(views).map((view) => view.error)).toEqual([undefined, undefined, undefined]);
  });

  it("withhold a coverage table that does not add up, though it is bound to the manifest", async () => {
    const [header, ...rows] = FLAT["coverage.csv"].trim().split("\n");
    const broken = [header, ...rows.map((row) => (row.startsWith("partial,") ? row.replace(/,\d+\/\d+$/, ",1/2") : row))].join("\n") + "\n";
    const views = await loadHistoricalViews(await catalogueFor({ ...FLAT, "coverage.csv": broken }));
    expect(views.coverage.error).toMatch(/does not add up/);
    expect(views.obr.value).toHaveLength(OBR.length);
  });

  it("withhold only the coverage when a count is too large to hold, and still show the page's other views", async () => {
    // Review's probe: a count of 309 nines once read as Infinity and threw
    // outside the per-view handling, hiding the whole page
    const [header, ...rows] = FLAT["coverage.csv"].trim().split("\n");
    const huge = [header, ...rows.map((row) => (row.startsWith("expressible,") ? row.replace(/^expressible,,\d+,/, `expressible,,${"9".repeat(309)},`) : row))].join("\n") + "\n";
    expect(huge).not.toBe(FLAT["coverage.csv"]);
    const views = await loadHistoricalViews(await catalogueFor({ ...FLAT, "coverage.csv": huge }));
    expect(views.coverage.error).toMatch(/is not a count/);
    expect(views.obr.value).toHaveLength(OBR.length);
    expect(views.notModelled.value).toHaveLength(NOT_MODELLED.length);
  });

  it("withhold a not-modelled list that leaves out a measure", async () => {
    const views = await loadHistoricalViews(await catalogueFor({ ...FLAT, "not_modelled.csv": toCsv(NOT_MODELLED_HEADER, NOT_MODELLED.slice(1)) }));
    expect(views.notModelled.error).toBe("The list of measures not modelled does not match the event's coverage");
    expect(views.coverage.value).toBeTruthy();
  });

  it("withhold a not-modelled list that names a measure the page models", async () => {
    const views = await loadHistoricalViews(await catalogueFor({ ...FLAT, "not_modelled.csv": toCsv(NOT_MODELLED_HEADER, [...NOT_MODELLED.slice(1), ["alpha", "Alpha", "partial", "", "", 1, "1"]]) }));
    expect(views.notModelled.error).toMatch(/does not match/);
  });
});

describe("the routes", () => {
  it("are one static page per past event, and no other", () => {
    expect(generateStaticParams()).toEqual(HISTORICAL_RELEASES.map((release) => ({ release: release.id })));
    expect(dynamicParams).toBe(false);
  });

  it("title each page with its event", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ release: RELEASE.id }) });
    expect(metadata.title).toBe(`${RELEASE.name} on today's model and data`);
    await expect(generateMetadata({ params: Promise.resolve({ release: CURRENT_BUDGET.id }) })).rejects.toThrow();
  });

  it("list every past event, newest first, each linking to its page", () => {
    render(<HistoricalReleases />);
    const links = screen.getAllByRole("link");
    const newestFirst = [...HISTORICAL_RELEASES].sort((a, b) => (a.date < b.date ? 1 : -1));
    expect(links.map((link) => link.textContent)).toEqual(newestFirst.map((release) => release.name));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(newestFirst.map((release) => `/budgets/${release.id}`));
  });
});

describe("the coverage panel", () => {
  it("adds up the measure counts exactly", () => {
    // Review's probe: two safe counts whose sum is not one once rendered
    // rounded, though the table's exact shares check out
    const big = "9007199254740991";
    const total = (BigInt(big) + 2n).toString();
    const text = toCsv(COVERAGE_HEADER, [
      ["expressible", "", big, 1, "1", "1", "1/1", `${big}/${total}`],
      ["partial", "", 2, 0, "0", "0", "0/1", `2/${total}`],
      ["not_expressible", "", 0, 0, "0", "0", "0/1", `0/${total}`],
      ["out_of_household_scope", "", 0, 0, "0", "0", "0/1", `0/${total}`],
      ["computed_by_replay", "", 2, 1, "", "1", "1/1", `2/${total}`],
    ]);
    const coverage = parseCoverage(text);
    expect(coverageProblems(coverage)).toEqual([]);
    render(<CoveragePanel coverage={coverage} measures={[]} />);
    expect(document.querySelector(".coverage-panel")).toHaveTextContent(`each of the event's ${total} measures`);
    expect(total).toBe("9007199254740993");
  });
});

describe("formatBn", () => {
  it("signs with a true minus, and reads a missing value as a dash", () => {
    expect(formatBn(-1.25)).toBe("−£1.3bn");
    expect(formatBn(-0.01)).toBe("£0.0bn");
    expect(formatBn(null)).toBe("—");
    expect(formatBn(Number.NaN)).toBe("—");
  });
});

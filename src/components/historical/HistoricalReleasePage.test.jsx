import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoricalReleasePage, { CoveragePanel, formatBn, HISTORICAL_PROVISIONAL_LABEL, loadHistoricalViews, SCORECARD_URL } from "./HistoricalReleasePage";
import { isDisplayable, PROVISIONAL_LABEL } from "../../utils/publication/manifest";
import HistoricalRelease, { dynamicParams, generateMetadata, generateStaticParams } from "../../app/budgets/[release]/page";
import HistoricalReleases from "../../app/budgets/page";
import { coverageOf, releaseFixtureFetch, toCsv } from "../../test/historicalFixture";
import { fixtureJson, IN_DATA } from "../../test/publicationFixture";
import { COVERAGE_HEADER, coverageProblems, NOT_MODELLED_HEADER, OBR_HEADER, fraction, parseCoverage } from "../../utils/historical";
import { CURRENT_BUDGET, dataRoot, HISTORICAL_RELEASES } from "../../utils/publication/release";
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

const ready = () => screen.findByText("Today's model and data, not what was known at the time.", {}, { timeout: 5000 });

describe("a past event's page", () => {
  it("says the figures are on today's model and data, and names that model and data", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: RELEASE.name })).toBeInTheDocument();
    const banner = screen.getByRole("note");
    const { model, data } = fixtureJson("manifest.json").execution.identity;
    expect(banner).toHaveTextContent(`${model.name} ${model.version}, ${data.dataset} (build ${data.build_id})`);
    expect(banner).toHaveTextContent("They are not the estimates published at the time.");
    // The fixture publishes one year, named once
    expect(banner).toHaveTextContent(`today's law, for ${IN_DATA}-${String((IN_DATA + 1) % 100).padStart(2, "0")}.`);
    // The revenue chart, with its one sentence for the year shown (main's
    // description, which replaced its fixed one)
    const yearShown = `${IN_DATA}-${String((IN_DATA + 1) % 100).padStart(2, "0")}`;
    expect(screen.getByText(new RegExp(`^In ${yearShown}, the selected measures `))).toBeInTheDocument();
    // A past event awaits no Treasury costing
    expect(screen.getByText(HISTORICAL_PROVISIONAL_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(PROVISIONAL_LABEL)).toBeNull();
    // Any sum is labelled as a sum of separately costed measures
    expect(await screen.findByText(/sum of the measures, each costed on its own/)).toBeInTheDocument();
  });

  it("offers only the event's own years in its year pill, not this Budget's", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Year / }));
    const label = `${IN_DATA}-${String((IN_DATA + 1) % 100).padStart(2, "0")}`;
    expect(screen.getAllByRole("option").map((option) => option.textContent.replace("✓", "").trim())).toEqual([label]);
  });

  it("gives every element a unique id, its section headings' included", async () => {
    // Main's SectionHeading takes its title's slug as its id unless given one
    const { container } = render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    await screen.findByText(/sum of the measures, each costed on its own/);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids).toEqual(expect.arrayContaining(["coverage", "coverage-heading", "revenue", "deciles"]));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("reads every file from its own release root, and nothing from this Budget's", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    await screen.findByRole("heading", { name: "Revenue impact" });
    const root = `${dataRoot("", RELEASE)}/`;
    expect(fetchImpl.calls.length).toBeGreaterThan(3);
    expect(fetchImpl.calls.every((url) => url.startsWith(root))).toBe(true);
    for (const file of Object.keys(FLAT)) expect(fetchImpl.calls).toContain(`${root}${file}`);
  });

  it("says what it is built with, as this Budget's About drawer does, each link in a new tab", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    const line = document.querySelector(".historical-built-with");
    expect(line.textContent).toMatch(/^Built with our replication code \(opens in a new tab\)( on policyengine\.py \S+ \(opens in a new tab\))?\.$/);
    const links = [...line.querySelectorAll("a")];
    expect(links[0].getAttribute("href")).toBe("https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026");
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("shows the coverage with exact shares, and the replay's computed measures", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    const coverage = document.getElementById("coverage");
    const total = MEASURES.length;
    expect(coverage).toHaveTextContent(`Its replay computed ${PAGE_IDS.length} of the ${total}`);
    const partial = within(coverage).getByText("Partly expressible").closest("tr");
    // The fixture's measures, a share of every measure of the event
    expect(partial).toHaveTextContent(`${PAGE_IDS.length}${((100 * PAGE_IDS.length) / total).toFixed(1)}%`);
    expect(within(coverage).getByText(/No executable construction yet/)).toBeInTheDocument();
  });

  it("counts the measures with figures here apart from those the replay computed", async () => {
    // Review's probe: the replay computed every measure the fixture
    // publishes, but some of them are held or not computable, so the
    // coverage once claimed more measures with figures than the page has
    const measures = fixtureJson("manifest.json").measures;
    const shown = PAGE_IDS.filter((id) => isDisplayable(measures[id])).length;
    expect(shown).toBeLessThan(PAGE_IDS.length);
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    const coverage = document.getElementById("coverage");
    expect(coverage).toHaveTextContent(`This page has figures for ${shown} of its ${PAGE_IDS.length} measures; the others are listed above as unavailable.`);
    expect(coverage).not.toHaveTextContent("with figures on this page");
  });

  it("lists the measures it does not model by class and gap, with their reasons", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Measures not modelled" }));
    const list = document.querySelector(".not-modelled");
    expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Not expressible: No executable construction yet. This does not show that the model lacks the tax or benefit. (1)",
      "Not expressible: A model mechanism or data input is missing. (1)",
      "Outside household scope (1)",
    ]);
    expect(list).toHaveTextContent("The data has no gadgets.");
    expect(list).toHaveTextContent("£0.3bn");
  });

  it("compares with the OBR's costing beside this page's figure and the scorecard's", async () => {
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Compare with the OBR's costing" }));
    const table = document.querySelector(".historical-obr-table");
    const alpha = within(table).getByText("Alpha").closest("tr");
    expect(alpha).toHaveTextContent("£2.5bn£2.0bn");
    expect(alpha).toHaveTextContent("£1.9bn");
    // An empty replay cell is missing, never zero
    expect(within(table).getByText("Beta").closest("tr")).toHaveTextContent(/—$/);
    const note = document.querySelector(".historical-obr");
    expect(note).toHaveTextContent(PAIR);
    expect(within(note).getByRole("link", { name: "scorecard" })).toHaveAttribute("href", SCORECARD_URL);
  });

  it("shows nothing when its root holds another release's manifest", async () => {
    await serve({ identity: CURRENT_BUDGET });
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    expect(await screen.findByText(`Published results for the ${RELEASE.name} are unavailable`)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Revenue impact" })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says so when no results are published yet", async () => {
    await serve({ overrides: { "manifest.json": 404 } });
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    expect(await screen.findByText(`No results for the ${RELEASE.name} are published yet`)).toBeInTheDocument();
  });

  it("withholds a flat view whose bytes changed, and shows the rest", async () => {
    await serve({ overrides: { "coverage.csv": `${FLAT["coverage.csv"]}\n` } });
    render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await ready();
    expect(screen.getByText("The coverage of this event is unavailable")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Revenue impact" })).toBeInTheDocument();
  });
});

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

  it("render the event's page for its id", async () => {
    render(await HistoricalRelease({ params: Promise.resolve({ release: RELEASE.id }) }));
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: RELEASE.name })).toBeInTheDocument();
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

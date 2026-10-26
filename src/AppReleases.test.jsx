import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import App, { pastEventAddress, RELEASE_PARAM, viewsFor } from "./App";
import HistoricalRelease from "./app/budgets/[release]/page";
import { HISTORICAL_PROVISIONAL_LABEL, SCORECARD_URL } from "./components/historical/PastEvent";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { coverageOf, releaseFixtureFetch, toCsv } from "./test/historicalFixture";
import { fixtureJson, IN_DATA } from "./test/publicationFixture";
import { fraction, NOT_MODELLED_HEADER, OBR_HEADER } from "./utils/historical";
import { isDisplayable, PROVISIONAL_LABEL } from "./utils/publication/manifest";
import { CURRENT_BUDGET, dataRoot, DEFAULT_RELEASE, findRelease, HISTORICAL_RELEASES, newestFirst } from "./utils/publication/release";

// The charts and the views that load their own files are stood in for, so
// the render is the page's own markup and the figures it hands the charts.
// The rows come in the order their artifacts verified, which can differ
// between loads, so the stand-ins list them sorted.
const { inOrder } = vi.hoisted(() => ({
  inOrder: (rows) => [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
}));
vi.mock("./components/BudgetaryImpactChart", () => ({
  default: ({ data, selectedYear }) => <div data-testid="budget-figures" data-year={selectedYear} data-rows={JSON.stringify(data)} />,
}));
vi.mock("./components/DistributionalChart", () => ({
  default: ({ rawData, selectedPolicies, selectedYear }) => <div data-testid="distributional-figures" data-year={selectedYear} data-rows={JSON.stringify(inOrder(rawData))} data-selected={JSON.stringify(selectedPolicies)} />,
}));
vi.mock("./components/WaterfallChart", () => ({
  default: ({ rawData, selectedYear }) => <div data-testid="winners-losers-figures" data-year={selectedYear} data-rows={JSON.stringify(inOrder(rawData))} />,
}));
vi.mock("./components/ConstituencyMap", () => ({ default: () => <div data-testid="constituency-view" /> }));
vi.mock("./components/HouseholdScatter", () => ({ default: () => <div data-testid="scatter-view" /> }));
vi.mock("./components/PersonalImpactTab", () => ({ default: () => <div data-testid="household-view" /> }));
vi.mock("./components/OBRComparisonTable", () => ({ default: () => null, ObrComparisonFoot: () => <div data-testid="obr-foot-2026" /> }));
vi.mock("./components/YoungPeopleSection", () => ({ default: () => <div data-testid="young-view" />, YOUNG_PEOPLE_ANCHOR: "young-people" }));
vi.mock("./components/MethodologyTab", () => ({ default: () => <div data-testid="methodology-view" />, METHOD_SECTIONS: { geography: "geography" } }));
vi.mock("./components/PolicyCards", () => ({ default: () => <div data-testid="policies-view" /> }));
// The Pre-measures forecast, and CurrentLawSection, which Population
// impact's Living standards sub-tab shows beside the decile charts (#185)
vi.mock("./components/livingStandards/LivingStandardsTab", () => ({
  default: () => <div data-testid="outlook-view" />,
  CurrentLawSection: () => <div data-testid="current-law" />,
}));

/** A fetch stand-in serving this Budget's fixture, recording every URL. */
function recordingFetch(options) {
  const serve = dashboardFixtureFetch(options);
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(String(url));
    return serve(url, init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

beforeEach(() => { window.history.replaceState({}, "", "/"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the 2026 page with no past event to choose", () => {
  // Captured at #107's head, before the budget selector: with only this
  // Budget published, the page renders exactly this and requests exactly
  // these files. Regenerate (vitest -u) only for an intended change to the
  // 2026 page.
  it("renders byte for byte as before the budget selector, and requests nothing more", async () => {
    const fetchImpl = recordingFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { container } = render(<App />);
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/app-2026-loading.html");
    await screen.findByTestId("budget-figures");
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/app-2026-loaded.html");
    expect(window.location.search).toBe("");
    await expect(`${[...fetchImpl.calls].sort().join("\n")}\n`).toMatchFileSnapshot("./__snapshots__/app-2026-requests.txt");
  });
});

// Synthetic flat views for a past event built from the publication
// fixture: its coverage, the measures it does not model and its OBR
// comparison. Test data only; never real figures.
const FIXTURE_MEASURES = fixtureJson("manifest.json").measures;
const PAGE_IDS = Object.keys(FIXTURE_MEASURES);
const DISPLAYABLE_IDS = PAGE_IDS.filter((id) => isDisplayable(FIXTURE_MEASURES[id]));
const cell = (pounds, places = 0) => ({ classification: "partial", gap: null, value: fraction(BigInt(pounds), 10n ** BigInt(places)), constructed: true });
const UNMODELLED = [
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

/** The three flat views of a past event whose page models `ids`. */
function flatFor(ids = PAGE_IDS) {
  const measures = [
    ...ids.map((id, index) => ({ id, classification: "partial", gap: "model_or_data_gap", computed: true, rows: [cell(1_000_000_000 * (index + 1)), { ...cell(-250_000_000), classification: "out_of_household_scope", constructed: false }] })),
    ...UNMODELLED,
  ];
  return {
    "coverage.csv": coverageOf(measures),
    "not_modelled.csv": toCsv(NOT_MODELLED_HEADER, NOT_MODELLED),
    "obr_comparison.csv": toCsv(OBR_HEADER, OBR.filter(([id]) => ids.includes(id))),
  };
}

/**
 * The whole site: this Budget's fixture at the data root, and each past
 * event in `past` (id to releaseFixtureFetch options) at its own root. A
 * past event not listed has no files. `gates` holds a past event's
 * artifacts until its promise settles. Every URL is recorded.
 */
async function siteFetch({ past = {}, current, gates = {} } = {}) {
  const thisBudget = dashboardFixtureFetch(current);
  const roots = await Promise.all(Object.entries(past).map(async ([id, options]) => {
    const release = findRelease(id);
    return { id, root: `${dataRoot("", release)}/`, serve: await releaseFixtureFetch(release, options) };
  }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const text = String(url);
    calls.push(text);
    const site = roots.find(({ root }) => text.startsWith(root));
    if (site) {
      if (gates[site.id] && text.includes("/artifacts/")) await gates[site.id];
      return site.serve(url, init);
    }
    if (text.startsWith("/data/releases/")) return new Response(null, { status: 404 });
    return thisBudget(url, init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const [AB2025, SS2025, AB2024] = ["uk-autumn-budget-2025", "uk-spring-statement-2025", "uk-autumn-budget-2024"].map(findRelease);
const BANNER = "Today's model and data, not what was known at the time.";

async function open(fetchImpl, { candidates = [], url = "/", element = <App /> } = {}) {
  window.history.replaceState({}, "", url);
  vi.stubGlobal("fetch", fetchImpl);
  if (candidates.length) vi.stubEnv("NEXT_PUBLIC_PUBLISHED_RELEASES", candidates.map((release) => release.id).join(","));
  const view = render(element);
  await screen.findByTestId("budget-figures");
  return view;
}

const pill = () => screen.queryByRole("button", { name: /^Budget: / });

/** Choose a release in the band, and wait for its figures. */
async function choose(release) {
  fireEvent.click(pill());
  fireEvent.click(within(screen.getByRole("listbox", { name: "Budget" })).getByRole("option", { name: release.name }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(release === DEFAULT_RELEASE ? "UK Autumn Budget 2026" : release.name));
  await screen.findByTestId("budget-figures");
}

const offeredNames = () => {
  fireEvent.click(pill());
  const names = within(screen.getByRole("listbox", { name: "Budget" })).getAllByRole("option").map((option) => option.textContent.replace("✓", ""));
  fireEvent.keyDown(screen.getByRole("listbox", { name: "Budget" }), { key: "Escape" });
  return names;
};

const shownIds = () => new Set(JSON.parse(screen.getByTestId("distributional-figures").dataset.selected));
const rowIds = () => new Set(JSON.parse(screen.getByTestId("distributional-figures").dataset.rows).map((row) => row.reform_id));
const tabs = () => within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab").map((tab) => tab.textContent);
const param = (name) => new URLSearchParams(window.location.search).get(name);

describe("the budget selector", () => {
  it("is not shown while every past event the build lists fails to verify, and asks only for their manifests", async () => {
    const fetchImpl = await siteFetch({ past: { [SS2025.id]: { identity: CURRENT_BUDGET } } });
    await open(fetchImpl, { candidates: [AB2025, SS2025] });
    await waitFor(() => expect(fetchImpl.calls).toContain(`${dataRoot("", SS2025)}/manifest.json`));
    expect(pill()).toBeNull();
    expect(document.querySelector(".has-releases, .band-release")).toBeNull();
    expect(fetchImpl.calls.filter((url) => url.startsWith("/data/releases/")).sort()).toEqual(
      [AB2025, SS2025].map((release) => `${dataRoot("", release)}/manifest.json`).sort(),
    );
  });

  it("offers this Budget and every past event whose manifest verifies, newest first", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2024.id]: { flat: flatFor() }, [AB2025.id]: { flat: flatFor() }, [SS2025.id]: { identity: { id: AB2025.id, date: AB2025.date } } } });
    await open(fetchImpl, { candidates: [AB2024, AB2025, SS2025] });
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(pill()).toHaveAccessibleName("Budget: Autumn Budget 2026");
    expect(offeredNames()).toEqual(["Autumn Budget 2026", "Autumn Budget 2025", "Autumn Budget 2024"]);
    expect(document.querySelector(".title-row")).toHaveClass("has-releases");
  });

  it("keeps this Budget listed when its own manifest fails, and shows that as unavailable", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } }, current: { overrides: { "manifest.json": "{}" } } });
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_RELEASES", AB2025.id);
    render(<App />);
    expect(await screen.findByText("Published results are unavailable")).toBeInTheDocument();
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(offeredNames()).toEqual(["Autumn Budget 2026", "Autumn Budget 2025"]);
    await choose(AB2025);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("shows a past event as its one view, with its own sections, and this Budget again as it was", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    const { container } = await open(fetchImpl, { candidates: [AB2025] });
    await waitFor(() => expect(pill()).not.toBeNull());
    const before = container.innerHTML;
    await choose(AB2025);
    expect(param(RELEASE_PARAM)).toBe(AB2025.id);
    expect(tabs()).toEqual(["Population impact"]);
    expect(screen.queryByRole("tablist", { name: "Population impact sections" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(BANNER);
    expect(container.querySelector(".dashboard-intro")).toBeNull();
    expect(document.getElementById("coverage")).toHaveTextContent("The scorecard sorts each of the event's");
    expect(screen.getByRole("button", { name: "Compare with the OBR's costing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Measures not modelled" })).toBeInTheDocument();
    for (const id of ["household-view", "outlook-view", "policies-view", "methodology-view", "young-view", "constituency-view", "scatter-view", "current-law", "obr-foot-2026"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(container.querySelector(".app")).toHaveClass("historical-release");
    expect(within(screen.getByRole("link", { name: "PolicyEngine scorecard" }).parentElement).getByRole("link")).toHaveAttribute("href", SCORECARD_URL);
    await choose(DEFAULT_RELEASE);
    expect(param(RELEASE_PARAM)).toBeNull();
    expect(tabs()).toEqual(["Population impact", "Household impact", "Pre-measures forecast", "Policies", "Methodology"]);
    // The same page, but for the ids React generates afresh on a new mount
    const ids = (html) => html.replace(/_r_[0-9a-z]+_/g, "_r_");
    expect(ids(container.innerHTML)).toBe(ids(before));
  });

  it("drops what belonged to the release left: its measures, sub-tab, Young people hash and views", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", "/?sub=young&policies=alpha,beta#young-people");
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_RELEASES", AB2025.id);
    render(<App />);
    await screen.findByTestId("young-view");
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(param("policies")).toBe("alpha,beta");
    await choose(AB2025);
    expect(window.location.search).toBe(`?${RELEASE_PARAM}=${AB2025.id}`);
    expect(window.location.hash).toBe("");
    expect(shownIds()).toEqual(new Set(DISPLAYABLE_IDS));
  });

  it("is hidden on the views a past event does not have", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    await open(fetchImpl, { candidates: [AB2025] });
    await waitFor(() => expect(pill()).not.toBeNull());
    const band = document.querySelector(".band-release");
    const app = document.querySelector(".app");
    expect(band).not.toHaveClass("is-hidden");
    expect(app).toHaveAttribute("data-release-pill", "shown");
    for (const name of ["Household impact", "Pre-measures forecast", "Policies", "Methodology"]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(band).toHaveClass("is-hidden");
      expect(band).toHaveAttribute("aria-hidden", "true");
      expect(app).not.toHaveAttribute("data-release-pill");
    }
  });

  it("opens the release a link names, keeping a selection it has, and drops a view it does not have", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}&tab=household&sub=young&policies=alpha`);
    vi.stubGlobal("fetch", fetchImpl);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(AB2025.name));
    await screen.findByTestId("budget-figures");
    expect(shownIds()).toEqual(new Set(["alpha"]));
    expect(tabs()).toEqual(["Population impact"]);
    await waitFor(() => expect(param("tab")).toBeNull());
    expect(param(RELEASE_PARAM)).toBe(AB2025.id);
    // Not offered: no build lists it, so the pill does not show
    expect(pill()).toBeNull();
    expect(fetchImpl.calls.every((url) => url.startsWith(`${dataRoot("", AB2025)}/`))).toBe(true);
  });

  it("drops this Budget's sub-tab and Young people hash from a link that opens a past event", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}&tab=living&sub=baseline&policies=alpha#young-people`);
    vi.stubGlobal("fetch", fetchImpl);
    render(<App />);
    await screen.findByTestId("budget-figures");
    expect(shownIds()).toEqual(new Set(["alpha"]));
    await waitFor(() => expect(param("tab")).toBeNull());
    expect(param("sub")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(param("policies")).toBe("alpha");
    expect(param(RELEASE_PARAM)).toBe(AB2025.id);
  });

  it("names the release a link opens, but lets only a verified one be chosen", async () => {
    // The build lists both; only Autumn Budget 2025 has files
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${SS2025.id}`);
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_RELEASES", [AB2025.id, SS2025.id].join(","));
    render(<App />);
    expect(await screen.findByText(`No results for the ${SS2025.name} are published yet`)).toBeInTheDocument();
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(pill()).toHaveAccessibleName(`Budget: ${SS2025.name}`);
    fireEvent.click(pill());
    const options = within(screen.getByRole("listbox", { name: "Budget" })).getAllByRole("option");
    const choosable = options.filter((option) => option.getAttribute("aria-disabled") !== "true").map((option) => option.textContent.replace("✓", ""));
    expect(choosable).toEqual([DEFAULT_RELEASE.name, AB2025.name]);
    const unverified = options.find((option) => option.textContent.includes(SS2025.name));
    expect(unverified).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unverified);
    expect(param(RELEASE_PARAM)).toBe(SS2025.id);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Budget" })).getByRole("option", { name: AB2025.name }));
    await screen.findByTestId("budget-figures");
    expect(param(RELEASE_PARAM)).toBe(AB2025.id);
    // Gone once another release is shown: it never verified
    expect(offeredNames()).toEqual([DEFAULT_RELEASE.name, AB2025.name]);
  });

  it.each(["uk-autumn-budget-1999", DEFAULT_RELEASE.id])("opens this Budget for ?budget=%s and takes it out of the address", async (id) => {
    const fetchImpl = await siteFetch();
    await open(fetchImpl, { url: `/?${RELEASE_PARAM}=${id}&policies=alpha` });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("UK Autumn Budget 2026");
    expect(param(RELEASE_PARAM)).toBeNull();
    expect(param("policies")).toBe("alpha");
    expect(fetchImpl.calls.some((url) => url.startsWith("/data/releases/"))).toBe(false);
  });

  it("never shows a release's header over another release's figures, even while it loads", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor(["alpha"]), measures: ["alpha"] } }, gates: { [AB2025.id]: gate } });
    await open(fetchImpl, { candidates: [AB2025] });
    await waitFor(() => expect(pill()).not.toBeNull());
    fireEvent.click(pill());
    fireEvent.click(within(screen.getByRole("listbox", { name: "Budget" })).getByRole("option", { name: AB2025.name }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(AB2025.name);
    expect(screen.queryByTestId("budget-figures")).toBeNull();
    expect(screen.queryByTestId("distributional-figures")).toBeNull();
    expect(screen.getByText("Loading published measures…")).toBeInTheDocument();
    // No years to offer yet, so no year pill; the band still keeps its pill
    // row, as the release pill is the way back (a compact band hides it on
    // a narrow screen)
    expect(document.querySelector(".band-year")).toHaveClass("is-hidden");
    expect(document.querySelector(".band-release")).not.toHaveClass("is-hidden");
    expect(document.querySelector(".app")).not.toHaveAttribute("data-band");
    expect(document.querySelector(".app")).toHaveAttribute("data-release-pill", "shown");
    await act(async () => { release(); });
    await screen.findByTestId("budget-figures");
    expect(shownIds()).toEqual(new Set(["alpha"]));
    expect(rowIds()).toEqual(new Set(["alpha"]));
  });

  it("stays in the band, leading back, when a past event's figures fail after it is offered", async () => {
    // Its manifest verifies, so it is offered; its one measure's receipt is
    // missing, so it has no figures and no years
    const missing = { [`${FIXTURE_MEASURES.alpha.artifact}/receipt.json`]: 404 };
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor(["alpha"]), measures: ["alpha"], overrides: missing } } });
    await open(fetchImpl, { candidates: [AB2025] });
    await waitFor(() => expect(pill()).not.toBeNull());
    fireEvent.click(pill());
    fireEvent.click(within(screen.getByRole("listbox", { name: "Budget" })).getByRole("option", { name: AB2025.name }));
    await waitFor(() => expect(screen.queryByText("Loading published measures…")).toBeNull());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(AB2025.name);
    expect(screen.queryByTestId("budget-figures")).toBeNull();
    expect(document.querySelector(".band-year")).toHaveClass("is-hidden");
    expect(document.querySelector(".app")).not.toHaveAttribute("data-band");
    expect(document.querySelector(".band-release")).not.toHaveClass("is-hidden");
    await choose(DEFAULT_RELEASE);
    expect(param(RELEASE_PARAM)).toBeNull();
  });

  it("never shows one release's files or figures under another's, whatever is published and chosen", async () => {
    const releaseIds = HISTORICAL_RELEASES.map((item) => item.id);
    const subset = fc.uniqueArray(fc.constantFrom(...DISPLAYABLE_IDS), { minLength: 1, maxLength: DISPLAYABLE_IDS.length - 1 }).map((ids) => [...ids].sort());
    const published = fc
      .uniqueArray(fc.record({ id: fc.constantFrom(...releaseIds), ids: subset }), { minLength: 1, maxLength: 3, selector: (item) => item.id })
      .filter((items) => new Set(items.map((item) => item.ids.join())).size === items.length);
    await fc.assert(
      fc.asyncProperty(published, fc.array(fc.nat(), { minLength: 1, maxLength: 3 }), async (events, picks) => {
        cleanup();
        vi.unstubAllEnvs();
        const fetchImpl = await siteFetch({ past: Object.fromEntries(events.map(({ id, ids }) => [id, { flat: flatFor(ids), measures: ids }])) });
        // The build lists every past event; only the published ones verify
        await open(fetchImpl, { candidates: HISTORICAL_RELEASES });
        await waitFor(() => expect(pill()).not.toBeNull());
        const offered = newestFirst([DEFAULT_RELEASE, ...events.map(({ id }) => findRelease(id))]);
        expect(offeredNames()).toEqual(offered.map((item) => item.name));
        let shown = DEFAULT_RELEASE;
        for (const pick of picks) {
          const target = offered[pick % offered.length];
          if (target === shown) continue;
          const from = fetchImpl.calls.length;
          await choose(target);
          shown = target;
          const calls = fetchImpl.calls.slice(from);
          expect(calls.length).toBeGreaterThan(0);
          if (target === DEFAULT_RELEASE) {
            expect(calls.every((url) => url.startsWith("/data/") && !url.startsWith("/data/releases/"))).toBe(true);
          } else {
            expect(calls.every((url) => url.startsWith(`${dataRoot("", target)}/`))).toBe(true);
          }
          // This Budget's decile charts are on Population impact's Living
          // standards sub-tab (#185); a past event's are on its one view
          if (target === DEFAULT_RELEASE) {
            fireEvent.click(within(screen.getByRole("tablist", { name: "Population impact sections" })).getByRole("tab", { name: "Living standards" }));
            await screen.findByTestId("distributional-figures");
          }
          const expected = target === DEFAULT_RELEASE ? DISPLAYABLE_IDS : events.find(({ id }) => id === target.id).ids;
          expect(shownIds()).toEqual(new Set(expected));
          for (const id of rowIds()) expect(expected).toContain(id);
          expect(tabs()).toEqual(viewsFor(target).map((view) => view.label));
          expect(param(RELEASE_PARAM)).toBe(target === DEFAULT_RELEASE ? null : target.id);
          expect(document.querySelector(".app")).not.toHaveAttribute("data-band");
          expect(document.querySelector(".app")).toHaveAttribute("data-release-pill", "shown");
        }
      }),
      { numRuns: 6 },
    );
  }, 300000);
});

// A past event's sections, as the dashboard shows them once it is chosen
// (they were #107's own page)
describe("a past event in the dashboard", () => {
  const openPast = async (options = {}) => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor(), ...options } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}`);
    vi.stubGlobal("fetch", fetchImpl);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(AB2025.name));
    return fetchImpl;
  };

  it("says the figures are on today's model and data, and names that model and data", async () => {
    await openPast();
    await screen.findByTestId("budget-figures");
    const banner = screen.getByRole("note");
    const { model, data } = fixtureJson("manifest.json").execution.identity;
    expect(banner).toHaveTextContent(`${model.name} ${model.version}, ${data.dataset} (build ${data.build_id})`);
    expect(banner).toHaveTextContent("They are not the estimates published at the time.");
    // The fixture publishes one year, named once
    expect(banner).toHaveTextContent(`today's law, for ${IN_DATA}-${String((IN_DATA + 1) % 100).padStart(2, "0")}.`);
    // A past event awaits no Treasury costing
    expect(screen.getByText(HISTORICAL_PROVISIONAL_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(PROVISIONAL_LABEL)).toBeNull();
    // Any sum is labelled as a sum of separately costed measures
    expect(screen.getByText(/sum of the measures, each costed on its own/)).toBeInTheDocument();
    // Its own years, the first chosen
    expect(screen.getByTestId("budget-figures").dataset.year).toBe(String(IN_DATA));
    expect(JSON.parse(screen.getByTestId("budget-figures").dataset.rows).map((point) => point.year)).toEqual([IN_DATA]);
  });

  it("reads every file from its own release root, and nothing from this Budget's", async () => {
    const fetchImpl = await openPast();
    await screen.findByTestId("budget-figures");
    const root = `${dataRoot("", AB2025)}/`;
    expect(fetchImpl.calls.length).toBeGreaterThan(3);
    expect(fetchImpl.calls.every((url) => url.startsWith(root))).toBe(true);
    for (const file of Object.keys(flatFor())) expect(fetchImpl.calls).toContain(`${root}${file}`);
  });

  it("shows the coverage with exact shares, and the replay's computed measures", async () => {
    await openPast();
    await screen.findByTestId("budget-figures");
    const coverage = document.getElementById("coverage");
    const total = PAGE_IDS.length + UNMODELLED.length;
    expect(coverage).toHaveTextContent(`Its replay computed ${PAGE_IDS.length} of the ${total}`);
    const partial = within(coverage).getByText("Partly expressible").closest("tr");
    expect(partial).toHaveTextContent(`${PAGE_IDS.length}75.0%`);
    expect(within(coverage).getByText(/No executable construction yet/)).toBeInTheDocument();
  });

  it("counts the measures with figures here apart from those the replay computed", async () => {
    // Review's probe: the replay computed every measure the fixture
    // publishes, but some of them are held or not computable
    expect(DISPLAYABLE_IDS.length).toBeLessThan(PAGE_IDS.length);
    await openPast();
    await screen.findByTestId("budget-figures");
    const coverage = document.getElementById("coverage");
    expect(coverage).toHaveTextContent(`This page has figures for ${DISPLAYABLE_IDS.length} of its ${PAGE_IDS.length} measures; the others are listed above as unavailable.`);
  });

  it("lists the measures it does not model by class and gap, with their reasons", async () => {
    await openPast();
    await screen.findByTestId("budget-figures");
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
    await openPast();
    await screen.findByTestId("budget-figures");
    fireEvent.click(screen.getByRole("button", { name: "Compare with the OBR's costing" }));
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

  it("tries a flat view that failed again on the next check, and shows it once it loads", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    let failures = 1;
    const flaky = async (url, init) => {
      if (String(url) === `${dataRoot("", AB2025)}/coverage.csv` && failures > 0) {
        failures -= 1;
        return new Response(null, { status: 503 });
      }
      return fetchImpl(url, init);
    };
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}`);
    vi.stubGlobal("fetch", flaky);
    render(<App />);
    expect(await screen.findByText("The coverage of this event is unavailable")).toBeInTheDocument();
    await screen.findByTestId("budget-figures");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByText("The coverage of this event is unavailable")).toBeNull());
    expect(within(document.getElementById("coverage")).getByText("Partly expressible")).toBeInTheDocument();
  });

  it("keeps its coverage and measures when the selection has an unavailable measure, and withholds only its figures", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}&policies=alpha,missing`);
    vi.stubGlobal("fetch", fetchImpl);
    render(<App />);
    expect(await screen.findByText("Some selected measures are unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
    expect(screen.queryByTestId("distributional-figures")).toBeNull();
    // The notice names what is unavailable; no count of a selection with it
    expect(document.querySelector(".showing-line")).toBeNull();
    expect(within(document.getElementById("coverage")).getByText("Partly expressible")).toBeInTheDocument();
    expect(document.getElementById("policy-details")).toHaveTextContent("About the modelled measures");
    expect(document.getElementById("policy-details")).toHaveTextContent("Measures not modelled");
    expect(screen.getByRole("link", { name: "PolicyEngine scorecard" })).toHaveAttribute("href", SCORECARD_URL);
    fireEvent.click(screen.getByRole("button", { name: "Remove missing from the selection" }));
    await screen.findByTestId("budget-figures");
    expect(shownIds()).toEqual(new Set(["alpha"]));
    expect(document.querySelector(".showing-line")).toHaveTextContent("Showing: Alpha");
  });

  it("names an unknown measure in a link without a selection note, alone or on an event with no figures", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}&policies=missing`);
    vi.stubGlobal("fetch", fetchImpl);
    const view = render(<App />);
    expect(await screen.findByText("Some selected measures are unavailable")).toBeInTheDocument();
    expect(document.querySelector(".showing-line")).toBeNull();
    expect(document.body).not.toHaveTextContent("undefined");
    view.unmount();

    // Its one measure's receipt is missing, so it has no figures and no
    // years; the notice still comes first, with its remove button
    const missing = { [`${FIXTURE_MEASURES.alpha.artifact}/receipt.json`]: 404 };
    const empty = await siteFetch({ past: { [AB2025.id]: { flat: flatFor(["alpha"]), measures: ["alpha"], overrides: missing } } });
    window.history.replaceState({}, "", `/?${RELEASE_PARAM}=${AB2025.id}&policies=missing`);
    vi.stubGlobal("fetch", empty);
    render(<App />);
    expect(await screen.findByText("Some selected measures are unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No figures for this event are published yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove missing from the selection" }));
    expect(await screen.findByText("No figures for this event are published yet.")).toBeInTheDocument();
    // An explicit selection stays explicit, now empty, as on the 2026 page
    expect(param("policies")).toBe("");
  });

  it("shows nothing when its root holds another release's manifest", async () => {
    await openPast({ identity: CURRENT_BUDGET });
    expect(await screen.findByText(`Published results for the ${AB2025.name} are unavailable`)).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
    expect(document.getElementById("coverage")).toBeNull();
  });

  it("says so when no results are published yet", async () => {
    await openPast({ overrides: { "manifest.json": 404 } });
    expect(await screen.findByText(`No results for the ${AB2025.name} are published yet`)).toBeInTheDocument();
    expect(screen.getByText(`Figures appear here once results for the ${AB2025.name} are published.`)).toBeInTheDocument();
    expect(screen.queryByTestId("budget-figures")).toBeNull();
  });

  it("withholds a flat view whose bytes changed, and shows the rest", async () => {
    await openPast({ overrides: { "coverage.csv": `${flatFor()["coverage.csv"]}\n` } });
    await screen.findByTestId("budget-figures");
    expect(screen.getByText("The coverage of this event is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare with the OBR's costing" })).toBeInTheDocument();
  });

  it("is what its own route opens, with this Budget a link away", async () => {
    const fetchImpl = await siteFetch({ past: { [AB2025.id]: { flat: flatFor() } } });
    vi.stubGlobal("fetch", fetchImpl);
    window.history.replaceState({}, "", `/budgets/${AB2025.id}`);
    render(await HistoricalRelease({ params: Promise.resolve({ release: AB2025.id }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(AB2025.name);
    await screen.findByTestId("budget-figures");
    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    cleanup();
    window.history.replaceState({}, "", `/budgets/${AB2025.id}?${RELEASE_PARAM}=${DEFAULT_RELEASE.id}`);
    render(await HistoricalRelease({ params: Promise.resolve({ release: AB2025.id }) }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("UK Autumn Budget 2026"));
    expect(param(RELEASE_PARAM)).toBe(DEFAULT_RELEASE.id);
  });
});

// A link's address, in its parts, as window.location gives them
const addressParts = (address) => {
  const at = address.indexOf("#");
  const beforeHash = at < 0 ? address : address.slice(0, at);
  const query = beforeHash.indexOf("?");
  return {
    pathname: query < 0 ? beforeHash : beforeHash.slice(0, query),
    search: query < 0 ? "" : beforeHash.slice(query),
    hash: at < 0 ? "" : address.slice(at),
  };
};

describe("a past event's address from a link", () => {
  // A link's query as written, not as URLSearchParams would write it: a
  // value can hold a comma or a plus, which writing it again would encode
  const pairs = fc.array(
    fc.tuple(fc.constantFrom(RELEASE_PARAM, "tab", "sub", "policies", "year", "other"), fc.constantFrom("", "alpha", "alpha,beta", "a+b", "%2C")),
    { maxLength: 6 },
  );
  const hashes = fc.constantFrom("", "#young-people", "#coverage", "#young-people-2");

  it("loses only ?sub= and #young-people, keeps the rest in order, and is unchanged with neither", () => {
    fc.assert(
      fc.property(pairs, hashes, (link, hash) => {
        const search = link.length ? `?${link.map(([key, value]) => `${key}=${value}`).join("&")}` : "";
        const address = pastEventAddress({ pathname: "/budgets/x", search, hash });
        const parts = addressParts(address);
        expect(parts.pathname).toBe("/budgets/x");
        expect([...new URLSearchParams(parts.search)]).toEqual([...new URLSearchParams(search)].filter(([key]) => key !== "sub"));
        expect(parts.hash).toBe(hash === "#young-people" ? "" : hash);
        if (!link.some(([key]) => key === "sub") && hash !== "#young-people") expect(address).toBe(`/budgets/x${search}${hash}`);
        expect(pastEventAddress(parts)).toBe(address);
      }),
      { numRuns: 300 },
    );
  });
});

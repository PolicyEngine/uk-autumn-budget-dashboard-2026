/**
 * Smoke test of the five tabs, and Population impact's other sub-tabs,
 * on the real data.
 *
 * Each tab is opened by its address (?tab=, ?sub=), as a shared link opens it, and
 * rendered with every data file served from public/ as the deployed page
 * serves it, and the household API answered with its fixture
 * (src/test/fixtures/householdImpact.json, shaped as the route's
 * contract). A tab fails if rendering throws, if anything logs a
 * console error, if a data file it fetches is missing, or if it shows an
 * error message instead of its content.
 *
 * Why jsdom and not a browser: it needs no new dependency or browser
 * download on runners that already queue, runs in the Frontend tests job
 * and on any laptop with bun, and reads the same files the build ships.
 * What jsdom cannot show (that the built site serves the page and these
 * files with HTTP 200) the "Built site" CI job checks against `next start`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { VIEWS } from "./App";
import { clearHouseholdImpactCache } from "./hooks/useHouseholdImpact";
import { clearBasisIncomeCache } from "./hooks/useBasisIncome";
import { clearOutlookCache } from "./utils/livingStandards/outlook";
import { resetSavedWizard } from "./components/HouseholdCalculator";
import { householdAnswerFor } from "./test/householdFixture";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { fixtureJson } from "./test/publicationFixture";
import { receiptEngine } from "./utils/publication/load";
import { CANDIDATE_PROVISIONAL_LABEL } from "./utils/publication/manifest";

// The receipt fixture's supported year follows the engine's projection
// end (currently beyond the dashboard's Budget-year window). Exercise the
// live calculator in that verified fixture year without rewriting receipts.
vi.mock("./utils/displayYears", async (original) => {
  const actual = await original();
  const { IN_DATA } = await import("./test/publicationFixture");
  return { ...actual, DEFAULT_DISPLAY_YEAR: IN_DATA, DISPLAY_YEARS: [...new Set([...actual.DISPLAY_YEARS, IN_DATA])] };
});

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const API = "https://household-api.test";
const HOUSEHOLD_API = `${API}/api/household-impact`;

// Results by area come only from the disclosure layer, which has not
// published them yet: the page shows "not yet published" on a 404.
const NOT_YET_PUBLISHED = new Set(["/data/regional.csv", "/data/constituency.csv", "/data/release-index.json"]);

// Text that means a tab failed instead of showing its content.
const FAILURE_TEXT = [
  /NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/,
  /Results are not available here/,
  /API error/,
  /Application error/,
  /Something went wrong/i,
  /could not be (loaded|fetched|read)/i,
  /HTTP \d{3}/,
];

// What each tab shows only once its data has loaded. (jsdom lays nothing
// out, so charts draw no values; these are the data-driven text around them.)
const LOADED = {
  // App.jsx renders All households' sections only once the CSVs are read.
  dashboard: (panel) => within(panel).findAllByRole("heading", { name: "Where and who" }),
  // Population impact's other sub-tabs, by ?sub=
  living: (panel) => within(panel).findAllByRole("heading", { name: "How the measures change incomes" }),
  poverty: (panel) => within(panel).findAllByRole("heading", { name: /Change in the poverty rate/ }),
  finances: (panel) => within(panel).findAllByRole("heading", { name: /Revenue impact/ }),
  // The cards, "Your household" first; the form and results are checked
  // below.
  household: (panel) => within(panel).findAllByRole("heading", { name: "Choose a household" }),
  // Population impact's Young people sub-tab (?sub=young): the cards
  // render once age_impact.csv is read.
  // Young people and Pensioners read the age table from verified artifacts;
  // the fixture's carry none, so both say so (#104)
  young: (panel) => within(panel).findAllByText(/Results by age are not available/),
  pensioners: (panel) => within(panel).findAllByText(/Results by age are not available/),
  // The OBR forecast's heading shows once the outlook is read.
  outlook: (panel) => within(panel).findAllByRole("heading", { name: "Forecast changes" }),
  // Every published measure's card, whatever the band's selection
  policies: (panel) => within(panel).findAllByRole("listitem"),
  methodology: (panel) => within(panel).findAllByRole("heading"),
};

// React's act() warning is a jsdom test artefact (state set after an
// awaited fetch); a browser never logs it. Any other console error fails.
const TEST_ONLY = /^An update to .* inside a test was not wrapped in act/;

let requests;
let consoleErrors;

const publicationFetch = dashboardFixtureFetch();

// The household API must run the model versions the approved receipts
// record, or Household impact shows nothing: answer with alpha's.
const PUBLISHED_ENGINE = receiptEngine(
  fixtureJson(`${fixtureJson("manifest.json").measures.alpha.artifact}/receipt.json`),
);
function publishedAnswerFor(body) {
  const answer = householdAnswerFor(body);
  return { ...answer, engine: { ...answer.engine, ...PUBLISHED_ENGINE } };
}

function serve(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (url.startsWith(HOUSEHOLD_API)) {
    const ok = url === HOUSEHOLD_API && method === "POST";
    requests.push({ url, status: ok ? 200 : 404, body: init.body });
    return ok
      ? new Response(JSON.stringify(publishedAnswerFor(init.body)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("{}", { status: 404 });
  }
  if (url.startsWith(API)) {
    // Any other route on the API
    requests.push({ url, status: 404 });
    return new Response("{}", { status: 404 });
  }
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/data/manifest.json" || pathname.startsWith("/data/artifacts/")) return publicationFetch(url, init);
  const path = normalize(join(PUBLIC, decodeURIComponent(pathname)));
  const found = path.startsWith(PUBLIC) && existsSync(path) && statSync(path).isFile();
  requests.push({ url: pathname, status: found ? 200 : 404 });
  return found ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
}

beforeEach(() => {
  requests = [];
  consoleErrors = [];
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  // Each test reads the outlook afresh, so its requests can be counted
  clearOutlookCache();
  // Each tab opens as a new visit would: the form at its first step
  resetSavedWizard();
  vi.stubGlobal("fetch", vi.fn(async (input, init) => serve(input, init)));
  vi.spyOn(console, "error").mockImplementation((...args) => {
    const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    if (!TEST_ONLY.test(message)) consoleErrors.push(message);
  });
  try {
    window.localStorage.clear();
  } catch {
    // no storage: nothing saved to clear
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Each tab by its address, and Population impact's other sub-tabs:
// [name, LOADED key, address, the panel's label]
const CASES = [
  // Population impact opens on Public finances; All households is ?sub=all
  ...VIEWS.map((v) => [v.label, v.value, v.value === "dashboard" ? "/?sub=all" : `/?tab=${v.value}`, v.label]),
  ["Population impact: Young people", "young", "/?sub=young", "Young people"],
  ["Population impact: Pensioners", "pensioners", "/?sub=pensioners", "Pensioners"],
  ["Population impact: Living standards", "living", "/?sub=living", "Living standards"],
  ["Population impact: Poverty", "poverty", "/?sub=poverty", "Poverty"],
  ["Population impact: Public finances", "finances", "/", "Public finances"],
];

describe("each of the five tabs and Population impact's sub-tabs, on a verified publication and real baseline data", () => {
  it("covers every tab", () => {
    expect(CASES.map((c) => c[1]).sort()).toEqual(Object.keys(LOADED).sort());
  });

  it.each(CASES)(
    "%s renders its content with no error",
    async (_name, value, address, label) => {
      window.history.replaceState({}, "", address);
      render(<App />);
      await waitFor(() => expect(document.querySelector('.app[data-publication="verified"]')).not.toBeNull());
      const panel = await screen.findByRole("tabpanel", { name: label });
      expect(await LOADED[value](panel, { timeout: 5000 })).not.toHaveLength(0);
      // Let every request the tab started settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      for (const pattern of FAILURE_TEXT) {
        expect(document.body.textContent, String(pattern)).not.toMatch(pattern);
      }
      expect(consoleErrors).toEqual([]);
      const missing = requests.filter(
        (r) => r.status !== 200 && !NOT_YET_PUBLISHED.has(r.url),
      );
      expect(missing).toEqual([]);
      if (value === "household") {
        // "Your household" opens the form; its first box is the head's
        // age, with its default
        fireEvent.click(within(panel).getByRole("button", { name: /^Your household/ }));
        expect(within(panel).getByRole("spinbutton", { name: "Age" })).toHaveValue(30);
        // Nothing is asked before Calculate
        expect(requests.filter((r) => r.url === HOUSEHOLD_API)).toEqual([]);
        // Every answer has a default: one press asks the household API in
        // two stages and shows the answer
        fireEvent.click(within(panel).getByRole("button", { name: /^Calculate/ }));
        expect(
          await within(panel).findByText(/^Change in your net income$/, {}, { timeout: 5000 }),
        ).toBeInTheDocument();
        await waitFor(() => expect(panel.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull(), {
          timeout: 5000,
        });
        const stages = requests
          .filter((r) => r.url === HOUSEHOLD_API)
          .map((r) => JSON.parse(r.body).include);
        expect(stages).toEqual([[], ["sweep"], ["by_policy"]]);
        expect(requests.filter((r) => r.url.startsWith(API)).every((r) => r.url === HOUSEHOLD_API)).toBe(
          true,
        );
        for (const pattern of FAILURE_TEXT) {
          expect(document.body.textContent, String(pattern)).not.toMatch(pattern);
        }
        expect(consoleErrors).toEqual([]);
      }
    },
    15000,
  );

  // Living standards and Poverty also show incomes and poverty under
  // current law, below the measures' effect, opened by
  // address (?sub=living, ?sub=poverty) with the outlook read once
  it.each([
    ["living", "Living standards", "How the measures change incomes", "Incomes under current law", ["Incomes over time", "Growth across the distribution"]],
    ["poverty", "Poverty", "How the measures change poverty", "Poverty under current law", ["Poverty over time", "Who is in poverty"]],
  ])("?sub=%s shows the current-law cards below the measures' effect", async (sub, label, measures, currentLaw, cards) => {
    window.history.replaceState({}, "", `/?sub=${sub}`);
    render(<App />);
    const panel = await screen.findByRole("tabpanel", { name: label });
    const [baseline] = await within(panel).findAllByRole("heading", { name: currentLaw }, { timeout: 5000 });
    for (const name of cards) {
      expect(within(panel).getByRole("heading", { level: 3, name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    }
    // Below the measures' effect, each subtitle saying with or without them
    const [effect] = within(panel).getAllByRole("heading", { name: measures });
    expect(effect.compareDocumentPosition(baseline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.textContent).toMatch(/With the selected measures:/);
    expect(panel.textContent).toMatch(/Without the measures:/);
    // No link to the sub-tab itself, nor away to the same cards
    expect(within(panel).queryByRole("link", { name: label })).toBeNull();
    expect(within(panel).queryByRole("link", { name: /Pre-measures forecast/ })).toBeNull();
    expect(requests.filter((r) => r.url.endsWith("living_standards_outlook.json"))).toHaveLength(1);
    expect(consoleErrors).toEqual([]);
  }, 15000);

  it("reads the outlook once for the sub-tab and the Pre-measures forecast", async () => {
    window.history.replaceState({}, "", "/?sub=living");
    render(<App />);
    const living = await screen.findByRole("tabpanel", { name: "Living standards" });
    await within(living).findByRole("heading", { level: 3, name: /^Incomes over time$/ }, { timeout: 5000 });
    // The Pre-measures forecast: the OBR forecast only, the outlook not
    // fetched again
    fireEvent.click(screen.getByRole("tab", { name: "Pre-measures forecast" }));
    const outlook = screen.getByRole("tabpanel", { name: "Pre-measures forecast" });
    expect(await within(outlook).findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(within(outlook).queryByRole("heading", { name: "Incomes under current law" })).toBeNull();
    expect(requests.filter((r) => r.url.endsWith("living_standards_outlook.json"))).toHaveLength(1);
    expect(document.querySelectorAll("#current-law-incomes")).toHaveLength(1);
  }, 15000);

  it("fails the Household impact tab when the API URL is not set", async () => {
    // The tab's call never leaves the page, and it says so where the
    // results would be: the check above would catch it.
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "");
    window.history.replaceState({}, "", "/?tab=personal");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Your household/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Calculate/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/),
    );
    expect(requests.some((r) => r.url.startsWith(API))).toBe(false);
  });

  it("keeps a household calculation running across a tab switch, and shows its answer on return", async () => {
    // Hold the household API's answers until released
    const held = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === HOUSEHOLD_API) {
          return new Promise((resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            held.push(() => resolve(serve(input, init)));
          });
        }
        return serve(input, init);
      }),
    );
    window.history.replaceState({}, "", "/?tab=personal");
    render(<App />);
    // The views are rebuilt once the publication verifies
    await waitFor(() => expect(document.querySelector('.app[data-publication="verified"]')).not.toBeNull());
    const personal = await screen.findByRole("tabpanel", { name: "Household impact" });
    fireEvent.click(await within(personal).findByRole("button", { name: /^Your household/ }));
    fireEvent.click(await within(personal).findByRole("button", { name: /^Calculate/ }));
    await waitFor(() => expect(held).toHaveLength(1));

    // Away to Methodology while the first stage is in flight
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(personal).not.toBeVisible();
    held.shift()();
    // The second stage (the sweep and the split by policy, asked for at
    // once) follows while the view is hidden
    await waitFor(() => expect(held).toHaveLength(2));
    held.shift()();
    held.shift()();
    await waitFor(() => expect(requests.filter((r) => r.url === HOUSEHOLD_API)).toHaveLength(3));

    // Back: the same view, with the finished answer, and nothing asked again
    fireEvent.click(screen.getByRole("tab", { name: "Household impact" }));
    expect(screen.getByRole("tabpanel", { name: "Household impact" })).toBe(personal);
    expect(await within(personal).findByText(/^Change in your net income$/)).toBeInTheDocument();
    await waitFor(() => expect(personal.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull());
    expect(requests.filter((r) => r.url === HOUSEHOLD_API)).toHaveLength(3);
    expect(held).toHaveLength(0);
  });

  it("shows no OBR comparison, not even a pending line, until the OBR's costings are in", async () => {
    window.history.replaceState({}, "", "/?sub=finances");
    render(<App />);
    await screen.findByRole("heading", { name: /Revenue impact/ }, { timeout: 5000 });
    expect(document.querySelectorAll("#obr-comparison")).toHaveLength(0);
    expect(document.querySelectorAll(".obr-pending")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Compare with OBR estimates" })).toBeNull();
  });

  it("says nothing that stops being true on Budget day, on any view but Methodology", async () => {
    window.history.replaceState({}, "", "/?sub=finances");
    render(<App />);
    await screen.findByRole("heading", { name: /Revenue impact/ }, { timeout: 5000 });
    for (const tab of ["All households", "Living standards", "Poverty", "Household impact", "Pre-measures forecast", "Population impact"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Every view opened so far stays mounted; Methodology is never opened
    // The one exception: the provisional label names candidate measures
    // while the manifest's basis is pre-Budget (Vahid, 26 October)
    const text = document.body.textContent.replaceAll(CANDIDATE_PROVISIONAL_LABEL, "");
    expect(text).not.toMatch(/pre-Budget/i);
    expect(text).not.toMatch(/28 October/);
    expect(text).not.toMatch(/candidate/i);
  });

  it("keeps a hidden view's progress inside it: nothing of it shows on another view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        // The household API never answers here
        if (url === HOUSEHOLD_API) return new Promise(() => {});
        return serve(input, init);
      }),
    );
    window.history.replaceState({}, "", "/?tab=household");
    render(<App />);
    await waitFor(() => expect(document.querySelector('.app[data-publication="verified"]')).not.toBeNull());
    const household = await screen.findByRole("tabpanel", { name: "Household impact" });
    fireEvent.click(await within(household).findByRole("button", { name: /^Your household/ }));
    fireEvent.click(await within(household).findByRole("button", { name: /^Calculate/ }));
    await waitFor(() => expect(household.querySelector(".processing-panel")).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(household).not.toBeVisible();
    for (const node of document.querySelectorAll(".processing-panel, .processing-bar, .skeleton-chip")) {
      expect(node.closest('[role="tabpanel"]')).toBe(household);
      expect(node).not.toBeVisible();
    }
    const methodology = screen.getByRole("tabpanel", { name: "Methodology" });
    expect(methodology).toBeVisible();
    expect(methodology.textContent).not.toMatch(/Calculating your household/);
  });
});

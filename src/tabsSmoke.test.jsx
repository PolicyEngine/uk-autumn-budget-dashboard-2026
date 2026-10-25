/**
 * Smoke test of the four tabs, and Population impact's Young people
 * sub-tab, on the real data.
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
import { resetSavedWizard } from "./components/HouseholdCalculator";
import { householdAnswerFor } from "./test/householdFixture";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { fixtureJson } from "./test/publicationFixture";
import { receiptEngine } from "./utils/publication/load";
import { receiptDefinitionFor, reportedDefinitions, requestedDefinitions, route } from "./test/definitionsFixture";

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
  // App.jsx renders the Public finances section only once the CSVs are read.
  dashboard: (panel) => within(panel).findAllByRole("heading", { name: "Public finances" }),
  // The form's list: its first row (Age) and the optional details; the
  // results are checked below.
  personal: (panel) => within(panel).findAllByRole("heading", { name: "More details" }),
  // Population impact's Young people sub-tab (?sub=young): the cards
  // render once age_impact.csv is read.
  young: (panel) => within(panel).findAllByText(/Results by age are not available/),
  // The Incomes heading shows once the outlook is read.
  living: (panel) => within(panel).findAllByRole("heading", { name: "Incomes" }),
  methodology: (panel) => within(panel).findAllByRole("heading"),
};

// React's act() warning is a jsdom test artefact (state set after an
// awaited fetch); a browser never logs it. Any other console error fails.
const TEST_ONLY = /^An update to .* inside a test was not wrapped in act/;

let requests;
let consoleErrors;

const publicationFetch = dashboardFixtureFetch();

// The household API must run the model versions the approved receipts
// record, or Personal impact shows nothing: answer with alpha's.
const PUBLISHED_ENGINE = receiptEngine(
  fixtureJson(`${fixtureJson("manifest.json").measures.alpha.artifact}/receipt.json`),
);
// And compute each measure from the definition its receipt approved: answer
// with each requested measure's.
const publishedDefinition = receiptDefinitionFor(fixtureJson);
function publishedAnswerFor(body, url) {
  const answer = householdAnswerFor(body);
  return {
    ...answer,
    engine: { ...answer.engine, ...PUBLISHED_ENGINE },
    definitions: reportedDefinitions(url, publishedDefinition),
  };
}

function serve(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (url.startsWith(HOUSEHOLD_API)) {
    const ok = route(url) === HOUSEHOLD_API && method === "POST";
    requests.push({ url, status: ok ? 200 : 404, body: init.body });
    return ok
      ? new Response(JSON.stringify(publishedAnswerFor(init.body, url)), {
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

// Each tab by its address, and Population impact's Young people sub-tab:
// [name, LOADED key, address, the panel's label]
const CASES = [
  ...VIEWS.map((v) => [v.label, v.value, v.value === "dashboard" ? "/" : `/?tab=${v.value}`, v.label]),
  ["Population impact: Young people", "young", "/?sub=young", "Young people"],
];

describe("each of the four tabs and the Young people sub-tab, on a verified publication and real baseline data", () => {
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
      if (value === "personal") {
        // The form's first row is the head's age, with its default
        expect(within(panel).getByRole("button", { name: /^Age/, expanded: false })).toHaveTextContent("Age30");
        // The results beside the form (every answer has a default): the tab
        // asks the household API in two stages and shows the answer
        expect(
          await within(panel).findByText(/The selected policies would/, {}, { timeout: 5000 }),
        ).toBeInTheDocument();
        await within(panel).findByRole("heading", { name: /Change in net income by policy/ }, { timeout: 5000 });
        const asked = requests.filter((r) => route(r.url) === HOUSEHOLD_API);
        expect(asked.map((r) => JSON.parse(r.body).include)).toEqual([[], ["by_policy", "sweep"]]);
        // Both stages name each selected measure's approved commit
        for (const r of asked) {
          const named = requestedDefinitions(r.url);
          expect(named.map(([id]) => id)).toEqual([...JSON.parse(r.body).policies].sort());
          for (const [id, commit] of named) expect(commit).toBe(publishedDefinition(id).git_sha);
        }
        expect(requests.filter((r) => r.url.startsWith(API)).every((r) => route(r.url) === HOUSEHOLD_API)).toBe(
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

  it("fails the Personal impact tab when the API URL is not set", async () => {
    // The tab's call never leaves the page, and it says so where the
    // results would be: the check above would catch it.
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "");
    window.history.replaceState({}, "", "/?tab=personal");
    render(<App />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/),
    );
    expect(requests.some((r) => r.url.startsWith(API))).toBe(false);
  });
});

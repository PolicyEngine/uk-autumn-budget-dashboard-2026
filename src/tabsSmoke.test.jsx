/**
 * Smoke test of the five tabs on the real data.
 *
 * Each tab is opened by its address (?tab=), as a shared link opens it, and
 * rendered with every data file served from public/ as the deployed page
 * serves it, and the lifecycle API answered with the real route's output
 * for the calculator's default household
 * (src/test/fixtures/lifecycle/default-household.json, written by
 * uk_budget_data.api), and the household API answered with the
 * single-year fixture (src/test/fixtures/householdImpact.json, shaped as
 * the Single-year effect's contract). A tab fails if rendering throws, if anything logs a
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
import lifecycleAnswer from "./test/fixtures/lifecycle/default-household.json";
import { householdAnswerFor } from "./test/householdFixture";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const LIFECYCLE_API = "https://lifecycle-api.test/api/lifecycle";
const HOUSEHOLD_API = "https://lifecycle-api.test/api/household-impact";

// Results by area come only from the disclosure layer, which has not
// published them yet: the page shows "not yet published" on a 404.
const NOT_YET_PUBLISHED = new Set(["/data/regional.csv", "/data/constituency.csv"]);

// Text that means a tab failed instead of showing its content.
const FAILURE_TEXT = [
  /NEXT_PUBLIC_LIFECYCLE_API_URL is not set/,
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
  // The wizard opens at its first step; the API call it makes on load is
  // checked below.
  personal: (panel) => within(panel).findAllByText(/Step 1 of 3/),
  // The cards render once age_impact.csv is read.
  young: (panel) => within(panel).findAllByRole("heading", { name: /Average change by age/ }),
  // The Incomes heading shows once the outlook is read.
  living: (panel) => within(panel).findAllByRole("heading", { name: "Incomes" }),
  methodology: (panel) => within(panel).findAllByRole("heading"),
};

// React's act() warning is a jsdom test artefact (state set after an
// awaited fetch); a browser never logs it. Any other console error fails.
const TEST_ONLY = /^An update to .* inside a test was not wrapped in act/;

let requests;
let consoleErrors;

function serve(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (url.startsWith(HOUSEHOLD_API)) {
    const ok = url === HOUSEHOLD_API && method === "POST";
    requests.push({ url, status: ok ? 200 : 404, body: init.body });
    return ok
      ? new Response(JSON.stringify(householdAnswerFor(init.body)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("{}", { status: 404 });
  }
  if (url.startsWith(LIFECYCLE_API)) {
    const ok = url === `${LIFECYCLE_API}/calculate` && method === "POST";
    requests.push({ url, status: ok ? 200 : 404 });
    return ok
      ? new Response(JSON.stringify(lifecycleAnswer), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("{}", { status: 404 });
  }
  const { pathname } = new URL(url, "http://localhost");
  const path = normalize(join(PUBLIC, decodeURIComponent(pathname)));
  const found = path.startsWith(PUBLIC) && existsSync(path) && statSync(path).isFile();
  requests.push({ url: pathname, status: found ? 200 : 404 });
  return found ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
}

beforeEach(() => {
  requests = [];
  consoleErrors = [];
  vi.stubEnv("NEXT_PUBLIC_LIFECYCLE_API_URL", LIFECYCLE_API);
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
  clearHouseholdImpactCache();
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

describe("each of the five tabs, on the real data", () => {
  it("covers every tab", () => {
    expect(VIEWS.map((v) => v.value).sort()).toEqual(Object.keys(LOADED).sort());
  });

  it.each(VIEWS.map((v) => [v.label, v.value]))(
    "%s renders its content with no error",
    async (label, value) => {
      window.history.replaceState({}, "", value === "dashboard" ? "/" : `/?tab=${value}`);
      render(<App />);
      const panel = screen.getByRole("tabpanel", { name: label });
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
        expect(requests.map((r) => r.url)).toContain(`${LIFECYCLE_API}/calculate`);
        // Straight to the results from step 1 (every answer has a default):
        // the Single-year effect asks the household API in two stages and
        // shows the answer
        fireEvent.click(within(panel).getByRole("button", { name: "See results" }));
        expect(
          await within(panel).findByText(/The selected policies would/, {}, { timeout: 5000 }),
        ).toBeInTheDocument();
        await within(panel).findByRole("heading", { name: /Change in net income by policy/ }, { timeout: 5000 });
        const stages = requests
          .filter((r) => r.url === HOUSEHOLD_API)
          .map((r) => JSON.parse(r.body).include);
        expect(stages).toEqual([[], ["by_policy", "sweep"]]);
        for (const pattern of FAILURE_TEXT) {
          expect(document.body.textContent, String(pattern)).not.toMatch(pattern);
        }
        expect(consoleErrors).toEqual([]);
      }
    },
    15000,
  );

  it("fails the Personal impact tab when the API URL is not set", async () => {
    // What production showed on 23 October: the tab's call never leaves
    // the page, and the console error is what the check above catches.
    vi.stubEnv("NEXT_PUBLIC_LIFECYCLE_API_URL", "");
    window.history.replaceState({}, "", "/?tab=personal");
    render(<App />);
    await waitFor(() =>
      expect(consoleErrors.join("\n")).toMatch(/NEXT_PUBLIC_LIFECYCLE_API_URL is not set/),
    );
    expect(requests.some((r) => r.url.startsWith(LIFECYCLE_API))).toBe(false);
  });
});

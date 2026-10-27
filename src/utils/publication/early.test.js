import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EARLY_FILES, earlyManifestScript, manifestUrl, takeEarlyManifest, takeEarlyResponse } from "./early";
import { isDisplayable, MANIFEST_FILE } from "./manifest";
import { loadArtifact, loadManifest } from "./load";
import { dataRoot, DEFAULT_RELEASE, HISTORICAL_RELEASES } from "./release";
import { isPastEventPath, PAST_EVENTS_PATH } from "../../components/historical/pastEventPaths";
import { BASE_PATH, fixtureFetch, fixtureJson } from "../../test/publicationFixture";

const manifest = fixtureJson("manifest.json");

function clearEarly() {
  vi.unstubAllGlobals();
  delete window.__ab26EarlyManifest;
  delete window.__ab26EarlyReceipts;
}

afterEach(() => {
  clearEarly();
  window.history.replaceState({}, "", "/");
});

async function runScript() {
  const fetchImpl = fixtureFetch();
  const stub = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", stub);
  // As the browser runs the inline script in <head>
  new Function(earlyManifestScript(BASE_PATH))();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return stub;
}

describe("the head's early requests", () => {
  it("requests the manifest, then only the shown artifacts' receipts and first-chart files", async () => {
    const stub = await runScript();
    const urls = stub.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe(`${BASE_PATH}/data/manifest.json`);
    const shown = [...Object.values(manifest.measures), ...Object.values(manifest.combined)].filter(isDisplayable);
    const receipts = urls.filter((url) => url.endsWith("/receipt.json"));
    expect(receipts.sort()).toEqual(shown.map((entry) => `${BASE_PATH}/data/${entry.artifact}/receipt.json`).sort());
    const files = urls.filter((url) => url.endsWith(".csv"));
    expect(files.length).toBeGreaterThan(0);
    for (const url of files) {
      expect(shown.some((entry) => url.startsWith(`${BASE_PATH}/data/${entry.artifact}/`))).toBe(true);
      expect(EARLY_FILES.some((file) => url.endsWith(`/${file}`))).toBe(true);
    }
  });

  it("never lets an early file stand in for its receipt's digest", async () => {
    // The head script fetched a file that has since changed: the loader
    // adopts the response but refuses its bytes
    const alpha = manifest.measures.alpha;
    const file = `${BASE_PATH}/data/${alpha.artifact}/budgetary_impact.csv`;
    window.__ab26EarlyReceipts = { [file]: Promise.resolve(new Response("reform_id,reform_name,year,value\nalpha,Alpha,2026,999\n")) };
    vi.stubGlobal("fetch", fixtureFetch());
    await expect(loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl: globalThis.fetch })).rejects.toThrow(/does not match its receipt/);
  });

  it("is adopted once by the page's loader, which still checks the manifest", async () => {
    const stub = await runScript();
    const loaded = await loadManifest(BASE_PATH, { fetchImpl: globalThis.fetch });
    expect(loaded.revision).toBe(manifest.revision);
    expect(stub.mock.calls.filter(([url]) => url.endsWith("manifest.json"))).toHaveLength(1);
    expect(takeEarlyManifest(`${BASE_PATH}/data/manifest.json`)).toBeNull();
    const receipt = `${BASE_PATH}/data/${manifest.measures.alpha.artifact}/receipt.json`;
    expect(takeEarlyResponse(receipt)).not.toBeNull();
    expect(takeEarlyResponse(receipt)).toBeNull();
  });
});

it("requests the examples' file under the name Household impact reads", async () => {
  const { PRESETS_FILE } = await import("../householdPresets");
  const { PRESETS_URL_FILE } = await import("./early");
  expect(PRESETS_URL_FILE).toBe(PRESETS_FILE);
});

describe("a past event's pages", () => {
  // Each reads its own release's files, from its own root: the head script
  // requests none of this Budget's there
  const pages = [
    PAST_EVENTS_PATH,
    `${PAST_EVENTS_PATH}/`,
    ...HISTORICAL_RELEASES.flatMap((release) => [`${PAST_EVENTS_PATH}/${release.id}`, `${PAST_EVENTS_PATH}/${release.id}/`]),
  ];

  it.each(pages)("request nothing early at %s", async (page) => {
    expect(isPastEventPath(`${BASE_PATH}${page}`, BASE_PATH)).toBe(true);
    window.history.replaceState({}, "", `${BASE_PATH}${page}?year=2024`);
    const stub = await runScript();
    expect(stub).not.toHaveBeenCalled();
    expect(takeEarlyManifest(manifestUrl(BASE_PATH))).toBeNull();
  });

  it.each(["/", "", "/?tab=household", "/budgets-archive", "/budget", `${PAST_EVENTS_PATH}-archive/x`])(
    "leave this Budget's page as it was: %s still requests its manifest",
    async (page) => {
      expect(isPastEventPath(`${BASE_PATH}${page}`.split("?")[0], BASE_PATH)).toBe(false);
      window.history.replaceState({}, "", `${BASE_PATH}${page}`);
      const stub = await runScript();
      expect(stub.mock.calls[0]?.[0]).toBe(manifestUrl(BASE_PATH));
    },
  );

  it("are exactly where isPastEventPath says, on any path", async () => {
    const segment = fc.constantFrom("budgets", "budgets-archive", "budget", "Budgets", "%62udgets", "uk", "autumn-budget-2026", HISTORICAL_RELEASES[0].id);
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(segment, { maxLength: 4 }), fc.boolean(), async (based, segments, slash) => {
        const path = `${based ? BASE_PATH : ""}/${segments.join("/")}${slash && segments.length ? "/" : ""}`;
        window.history.replaceState({}, "", path);
        const stub = await runScript();
        // What the script read, after the browser's own normalising
        const pathname = window.location.pathname;
        expect(stub.mock.calls.length === 0).toBe(isPastEventPath(pathname, BASE_PATH));
        clearEarly();
      }),
      { numRuns: 60 },
    );
  });

  it("never adopt this Budget's early manifest, which the loader reads only at its own URL", async () => {
    // As on this Budget's page: the script ran, then a past event's manifest
    // is read through the page's own fetch
    const stub = await runScript();
    expect(manifestUrl(BASE_PATH)).toBe(`${dataRoot(BASE_PATH, DEFAULT_RELEASE)}/${MANIFEST_FILE}`);
    for (const release of HISTORICAL_RELEASES) {
      expect(`${dataRoot(BASE_PATH, release)}/${MANIFEST_FILE}`).not.toBe(manifestUrl(BASE_PATH));
      await expect(loadManifest(BASE_PATH, { fetchImpl: globalThis.fetch, release })).resolves.toBeNull();
    }
    // Each past event's own URL was fetched, and this Budget's early
    // response is still there for its own loader
    for (const release of HISTORICAL_RELEASES) {
      expect(stub.mock.calls.some(([url]) => url === `${dataRoot(BASE_PATH, release)}/${MANIFEST_FILE}`)).toBe(true);
    }
    expect(takeEarlyManifest(manifestUrl(BASE_PATH))).not.toBeNull();
  });
});

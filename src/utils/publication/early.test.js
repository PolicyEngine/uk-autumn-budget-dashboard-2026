import { afterEach, describe, expect, it, vi } from "vitest";
import { EARLY_FILES, earlyManifestScript, takeEarlyManifest, takeEarlyResponse } from "./early";
import { isDisplayable } from "./manifest";
import { loadArtifact, loadManifest } from "./load";
import { BASE_PATH, fixtureFetch, fixtureJson } from "../../test/publicationFixture";

const manifest = fixtureJson("manifest.json");

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__ab26EarlyManifest;
  delete window.__ab26EarlyReceipts;
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

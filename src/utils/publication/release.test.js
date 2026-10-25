import fc from "fast-check";
import { describe, expect, it } from "vitest";
import registry from "../../uk_budget_data/releases.json";
import artifactPaths from "../../test/fixtures/artifact_paths.json";
import { loadArtifact, loadManifest, loadPublication } from "./load";
import { loadVerifiedFlatCsv } from "./flat";
import { isDisplayable, isSafeArtifactPath, ManifestError } from "./manifest";
import {
  assertCurrentRelease,
  assertRelease,
  CURRENT_BUDGET,
  CURRENT_RELEASE,
  dataRoot,
  DEFAULT_RELEASE,
  findRelease,
  getHistoricalRelease,
  HISTORICAL_RELEASES,
  RELEASES,
  RELEASES_DIR,
  releaseFor,
} from "./release";
import { loadDashboard } from "../loadDashboard";
import { BASE_PATH, fixtureBytes, fixtureJson } from "../../test/publicationFixture";
import { releaseFixtureFetch } from "../../test/historicalFixture";

const encoder = new TextEncoder();
const fixtureManifest = fixtureJson("manifest.json");

/** The fixture's manifest bytes, relabelled for a release (synthetic data). */
function manifestBytesFor(identity) {
  return encoder.encode(JSON.stringify({ ...fixtureManifest, release: identity.id, budget: identity }));
}

/**
 * A fetch stand-in serving the fixture's artifacts under one release's root,
 * with a manifest naming `identity`. Every requested URL is recorded.
 */
function releaseFetch(release, identity = { id: release.id, date: release.date }) {
  const calls = [];
  const prefix = `${dataRoot(BASE_PATH, release)}/`;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!url.startsWith(prefix)) return new Response(null, { status: 404 });
    const path = url.slice(prefix.length);
    if (path === "manifest.json") return new Response(manifestBytesFor(identity), { status: 200 });
    if (!path.startsWith("artifacts/")) return new Response(null, { status: 404 });
    try {
      return new Response(fixtureBytes(path), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const anyRelease = fc.constantFrom(...RELEASES);
const anyIdentity = fc.oneof(
  anyRelease.map((release) => ({ id: release.id, date: release.date })),
  fc.record({ id: fc.constantFrom(...RELEASES.map((r) => r.id), "uk-autumn-budget-2027"), date: fc.constantFrom(...RELEASES.map((r) => r.date), "2026-10-29") }),
);

describe("the release registry", () => {
  it("is the one Python reads, with this Budget as its only current release", () => {
    expect(RELEASES.map((release) => release.id)).toEqual(registry.releases.map((release) => release.id));
    expect(RELEASES.filter((release) => release.kind === "current")).toEqual([DEFAULT_RELEASE]);
    expect(CURRENT_RELEASE).toBe("uk-autumn-budget-2026");
    expect(CURRENT_BUDGET).toEqual({ id: "uk-autumn-budget-2026", date: "2026-10-28" });
  });

  it("keeps this Budget at the default root and every past event in its own", () => {
    expect(dataRoot(BASE_PATH)).toBe(`${BASE_PATH}/data`);
    for (const release of HISTORICAL_RELEASES) {
      expect(dataRoot(BASE_PATH, release)).toBe(`${BASE_PATH}/data/${RELEASES_DIR}/${release.id}`);
    }
  });

  it("refuses an id it does not list as a past event", () => {
    expect(() => getHistoricalRelease(CURRENT_RELEASE)).toThrow(ManifestError);
    expect(() => getHistoricalRelease("uk-autumn-budget-1999")).toThrow(ManifestError);
    expect(getHistoricalRelease(HISTORICAL_RELEASES[0].id)).toBe(HISTORICAL_RELEASES[0]);
  });
});

describe("a manifest authorises figures only for its own release", () => {
  it("is accepted exactly when it names the release asked for", () => {
    fc.assert(fc.property(anyRelease, anyIdentity, (release, identity) => {
      const manifest = { release: identity.id, budget: identity };
      const matches = identity.id === release.id && identity.date === release.date;
      if (matches) expect(assertRelease(manifest, release)).toBe(manifest);
      else expect(() => assertRelease(manifest, release)).toThrow(ManifestError);
    }));
  });

  it("keeps the 2026 check and its message", () => {
    expect(() => assertCurrentRelease({ release: HISTORICAL_RELEASES[0].id, budget: { id: HISTORICAL_RELEASES[0].id, date: HISTORICAL_RELEASES[0].date } }))
      .toThrow("release or Budget identity is not the 2026 Budget");
  });

  it("loads a manifest from the requested release's root, or refuses it", async () => {
    await fc.assert(fc.asyncProperty(anyRelease, anyIdentity, async (release, identity) => {
      const fetchImpl = releaseFetch(release, identity);
      const matches = identity.id === release.id && identity.date === release.date;
      const loading = loadManifest(BASE_PATH, { fetchImpl, release });
      if (matches) expect((await loading).release).toBe(release.id);
      else await expect(loading).rejects.toThrow(ManifestError);
      expect(fetchImpl.calls).toEqual([`${dataRoot(BASE_PATH, release)}/manifest.json`]);
    }), { numRuns: 60 });
  });

  it("refuses a loaded manifest handed to another release's loader", () => {
    fc.assert(fc.property(anyRelease, anyRelease, (own, asked) => {
      const manifest = { release: own.id, budget: { id: own.id, date: own.date } };
      if (own === asked) expect(releaseFor(manifest, asked)).toBe(own);
      else expect(() => releaseFor(manifest, asked)).toThrow(ManifestError);
      expect(releaseFor(manifest, undefined)).toBe(own);
    }));
    expect(releaseFor(null, undefined)).toBe(DEFAULT_RELEASE);
  });
});

describe("no release reads another release's files", () => {
  it("fetches only inside its own root, and this Budget never enters releases/", async () => {
    const ids = Object.keys(fixtureManifest.measures);
    await fc.assert(fc.asyncProperty(anyRelease, fc.subarray(ids), async (release, selection) => {
      const fetchImpl = releaseFetch(release);
      const result = await loadPublication(BASE_PATH, selection, { fetchImpl, release });
      expect(result.status).toBe("ready");
      expect(result.manifest.release).toBe(release.id);
      // The figures did load, from this root: every displayable selected
      // measure verified
      for (const id of selection) {
        if (isDisplayable(fixtureManifest.measures[id])) expect(Object.hasOwn(result.tablesByKey, id)).toBe(true);
      }
      const root = `${dataRoot(BASE_PATH, release)}/`;
      for (const url of fetchImpl.calls) {
        expect(url.startsWith(root)).toBe(true);
        if (release === DEFAULT_RELEASE) expect(url).not.toContain(`/data/${RELEASES_DIR}/`);
      }
    }), { numRuns: 40 });
  });

  it("loads the whole dashboard of a past event from its root alone", async () => {
    for (const release of HISTORICAL_RELEASES) {
      const fetchImpl = releaseFetch(release);
      const dashboard = await loadDashboard(BASE_PATH, { fetchImpl, release });
      expect(dashboard.status).toBe("ready");
      expect(dashboard.catalogue.manifest.release).toBe(release.id);
      expect(fetchImpl.calls.every((url) => url.startsWith(`${dataRoot(BASE_PATH, release)}/`))).toBe(true);
    }
  });

  it("serves no past event's figures on this Budget's page, nor the reverse", async () => {
    await fc.assert(fc.asyncProperty(anyRelease, anyRelease, async (served, asked) => {
      fc.pre(served !== asked);
      // The files sit only in `served`'s root; the page asks for `asked`
      const fetchImpl = releaseFetch(served);
      const result = await loadPublication(BASE_PATH, Object.keys(fixtureManifest.measures), { fetchImpl, release: asked });
      expect(result.status).toBe("no-manifest");
      expect(result.tablesByKey).toEqual({});
    }), { numRuns: 30 });
  });

  it("reads a flat view from the catalogue's release root", async () => {
    const release = HISTORICAL_RELEASES[0];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(null, { status: 404 });
    };
    const catalogue = { manifest: { ...fixtureManifest, release: release.id, budget: { id: release.id, date: release.date } } };
    await expect(loadVerifiedFlatCsv("coverage.csv", catalogue, { basePath: BASE_PATH, fetchImpl })).rejects.toThrow("release index is unavailable");
    expect(calls).toEqual([`${dataRoot(BASE_PATH, release)}/release-index.json`]);
    await expect(loadVerifiedFlatCsv("coverage.csv", catalogue, { basePath: BASE_PATH, fetchImpl, release: DEFAULT_RELEASE })).rejects.toThrow(ManifestError);
  });

  it("reads a past event's flat view with no area provenance, and refuses one that binds any", async () => {
    // Area provenance is this Budget's: a past event has no results by area
    const release = HISTORICAL_RELEASES[0];
    const flat = { "coverage.csv": "class,measures\n" };
    const read = async (provenance) => {
      const fetchImpl = await releaseFixtureFetch(release, { basePath: BASE_PATH, flat, provenance });
      const text = await loadVerifiedFlatCsv("coverage.csv", null, { basePath: BASE_PATH, fetchImpl, release });
      return { text, calls: fetchImpl.calls };
    };
    const { text, calls } = await read({});
    expect(text).toBe(flat["coverage.csv"]);
    expect(calls.some((url) => url.endsWith("/area_provenance.json"))).toBe(false);
    const digest = "0".repeat(64);
    for (const provenance of [{ manifest: digest }, { index: digest }, { manifest: digest, index: digest }]) {
      await expect(read(provenance)).rejects.toThrow("A past event binds no area provenance");
    }
  });

  it("refuses any artifact path into the reserved directory", () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/), { minLength: 1, maxLength: 4 }), (parts) => {
      expect(isSafeArtifactPath([RELEASES_DIR, ...parts].join("/"))).toBe(false);
      expect(isSafeArtifactPath(["artifacts", ...parts].join("/"))).toBe(true);
    }));
  });

  it("requests an accepted artifact path exactly as checked, inside its own root", () => {
    // Pieces a URL decodes, normalizes or delimits, beside ordinary ones
    const piece = fc.constantFrom(
      "artifacts", RELEASES_DIR, "alpha", "a+b", "uk-autumn-budget-2024", "80412ddca4d77bae",
      "", ".", "..", "%2e%2e", "%2E%2e", ".%2e", "%2f", "a%2fb", "%252e", "a?b", "a#b", "a\\b", "c:", "a b",
    );
    fc.assert(fc.property(fc.array(piece, { minLength: 1, maxLength: 6 }), (parts) => {
      const path = parts.join("/");
      if (!isSafeArtifactPath(path)) return;
      for (const release of RELEASES) {
        const root = dataRoot(BASE_PATH, release);
        const url = new URL(`${root}/${path}`, "https://example.org");
        expect(url.pathname).toBe(`${root}/${path}`);
        expect(url.search + url.hash).toBe("");
      }
      expect(path.split("/")[0]).not.toBe(RELEASES_DIR);
    }), { numRuns: 2000 });
  });

  it("refuses an encoded way into another release's root before fetching anything", async () => {
    const path = "artifacts/%2e%2e/releases/uk-autumn-budget-2024/artifacts/alpha/80412ddca4d77bae";
    expect(isSafeArtifactPath(path)).toBe(false);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(null, { status: 404 });
    };
    const entry = { ...fixtureManifest.measures.alpha, status: "approved", artifact: path };
    await expect(loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl })).rejects.toThrow("leaves its release's data root");
    expect(calls).toEqual([]);
  });

  it("agrees with Python on the shared artifact path cases", () => {
    // tests/test_historical_releases.py reads the same cases
    for (const [path, safe] of artifactPaths.cases) expect([path, isSafeArtifactPath(path)]).toEqual([path, safe]);
  });
});

describe("findRelease", () => {
  it("finds each registered release and nothing else", () => {
    for (const release of RELEASES) expect(findRelease(release.id)).toBe(release);
    expect(findRelease("uk-nope")).toBeUndefined();
  });
});

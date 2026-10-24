import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fixtureFetch, fixtureJson, fixtureText, BASE_PATH, IN_DATA } from "../../test/publicationFixture";
import { loadManifest } from "./load";
import { sha256Hex } from "./digest";
import { loadVerifiedFlat, loadVerifiedFlatCsv, RELEASE_INDEX_SCHEMA } from "./flat";
import { budgetChartData, loadDashboard } from "../loadDashboard";

// TEST DATA ONLY: a synthetic area table's bytes (the loader checks bytes,
// not columns)
const file = "regional.csv";
const csv = "level,area_code,reform,year,value\nregion,E12000001,alpha,2032,12\n";

async function flatSnapshot({ aliases = {} } = {}) {
  const manifest = fixtureJson("manifest.json");
  manifest.flat_files = { [file]: await sha256Hex(csv) };
  manifest.flat_aliases = aliases;
  const text = JSON.stringify(manifest);
  const index = { schema: RELEASE_INDEX_SCHEMA, release: manifest.release, budget: manifest.budget, manifest_revision: manifest.revision, manifest_sha256: await sha256Hex(text), files: manifest.flat_files, aliases };
  const overrides = { "manifest.json": text, "release-index.json": JSON.stringify(index), [file]: csv };
  const loaded = await loadManifest(BASE_PATH, { fetchImpl: fixtureFetch({ overrides }) });
  return { manifest: loaded, index, overrides };
}

describe("flat publication snapshot binding", () => {
  it("loads bytes only with the same manifest, revision and digest map", async () => {
    const { manifest, overrides } = await flatSnapshot();
    expect(await loadVerifiedFlatCsv(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) })).toBe(csv);
  });

  it.each(["revision", "manifest bytes", "file map", "CSV bytes", "Budget", "missing index"])("makes the view unavailable for changed %s", async (change) => {
    const { manifest, index, overrides } = await flatSnapshot();
    if (change === "revision") index.manifest_revision += 1;
    if (change === "manifest bytes") index.manifest_sha256 = "0".repeat(64);
    if (change === "file map") index.files = { [file]: "0".repeat(64) };
    if (change === "Budget") index.budget = { id: "uk-autumn-budget-2025", date: "2025-11-26" };
    overrides["release-index.json"] = change === "missing index" ? 404 : JSON.stringify(index);
    if (change === "CSV bytes") overrides[file] = csv.replace(",12", ",999");
    await expect(loadVerifiedFlatCsv(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) })).rejects.toThrow(/snapshot|index|manifest/);
  });

  it("rejects any changed CSV bytes rather than returning a number", async () => {
    const { manifest, overrides } = await flatSnapshot();
    await fc.assert(fc.asyncProperty(fc.string({ minLength: 1 }), async (extra) => {
      await expect(loadVerifiedFlatCsv(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides: { ...overrides, [file]: csv + extra } }) })).rejects.toThrow(/snapshot/);
    }), { numRuns: 30 });
  });
});

describe("national receipt binding", () => {
  it.each(["outputs", "CSV"])("withholds a stale approved %s snapshot, including its net figure", async (change) => {
    const manifest = fixtureJson("manifest.json");
    manifest.measures = { alpha: manifest.measures.alpha };
    manifest.combined = {};
    const overrides = {};
    if (change === "outputs") manifest.measures.alpha.outputs_sha256 = "0".repeat(64);
    if (change === "CSV") overrides[`${manifest.measures.alpha.artifact}/budgetary_impact.csv`] = fixtureText(`${manifest.measures.alpha.artifact}/budgetary_impact.csv`) + "\n";
    overrides["manifest.json"] = JSON.stringify(manifest);
    const loaded = await loadDashboard(BASE_PATH, { fetchImpl: fixtureFetch({ overrides }) });
    expect(loaded.budgetary).toEqual([]);
    expect(loaded.distributional).toEqual([]);
    expect(budgetChartData(loaded.budgetary, loaded.catalogue.displayable, ["alpha"], [IN_DATA])[0].netImpact).toBeNull();
    expect(loaded.catalogue.failures.alpha).toBeTruthy();
  });

  it("renders figures only when status, years and receipt bytes all authorise them", async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom("approved", "staged", "withdrawn", "stale"), fc.boolean(), fc.boolean(), async (status, tampered, supported) => {
      const manifest = fixtureJson("manifest.json");
      manifest.measures = { alpha: { ...manifest.measures.alpha, status } };
      manifest.combined = {};
      if (!supported) manifest.measures.alpha.unsupported_years = [...manifest.measures.alpha.years];
      const artifact = manifest.measures.alpha.artifact;
      const overrides = { "manifest.json": JSON.stringify(manifest) };
      if (tampered) overrides[`${artifact}/budgetary_impact.csv`] = "unreviewed figures";
      const loaded = await loadDashboard(BASE_PATH, { fetchImpl: fixtureFetch({ overrides }) });
      if (status !== "approved" || tampered || !supported) {
        expect(loaded.budgetary).toEqual([]);
        expect(loaded.distributional).toEqual([]);
      } else {
        expect(loaded.budgetary.length).toBeGreaterThan(0);
        expect(loaded.budgetary.every((row) => row.year === IN_DATA)).toBe(true);
      }
    }), { numRuns: 30 });
  });
});

describe("the flat view files", () => {
  it("are the same list in the page, the build check and the area files", async () => {
    const { FLAT_VIEW_FILES } = await import("./flat");
    const build = await import("../../../scripts/check-public-files.mjs");
    const { FILES } = await import("../geography/columns");
    expect([...FLAT_VIEW_FILES].sort()).toEqual([...build.FLAT_VIEW_FILES].sort());
    expect(Object.values(FILES).map(({ file }) => file).sort()).toEqual([...FLAT_VIEW_FILES].sort());
  });

  it("never include the OBR comparison: its file holds the November 2025 costings", async () => {
    const { manifest, overrides } = await flatSnapshot();
    await expect(loadVerifiedFlatCsv("obr_comparison.csv", { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) })).rejects.toThrow(/not a flat view file/);
  });
});

describe("aliases in the release index", () => {
  it("returns the package alias the area run used, mapped to its manifest key", async () => {
    const { manifest, overrides } = await flatSnapshot({ aliases: { package_alias: "combined--alpha+beta" } });
    const loaded = await loadVerifiedFlat(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) });
    expect(loaded.text).toBe(csv);
    expect({ ...loaded.aliases }).toEqual({ package_alias: "combined--alpha+beta" });
  });

  it.each([
    ["a key the manifest does not list", { package_alias: "combined--alpha+gamma" }],
    ["an alias that is itself a manifest key", { alpha: "combined--alpha+beta" }],
    ["no alias map", null],
    // Round-2 review: relabelling the package as a measure kept every digest
    ["aliases the manifest does not carry", { package_alias: "alpha" }],
  ])("refuses %s", async (_, aliases) => {
    const { manifest, index, overrides } = await flatSnapshot();
    index.aliases = aliases ?? undefined;
    overrides["release-index.json"] = JSON.stringify(index);
    await expect(loadVerifiedFlat(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) })).rejects.toThrow(/aliases/);
  });
});

describe("a page left open across a deploy", () => {
  it("says newer results are published when the live manifest has moved on", async () => {
    const { SnapshotChangedError } = await import("./flat");
    const { manifest } = await flatSnapshot();
    // The next deploy: a new manifest revision with its own index
    const next = fixtureJson("manifest.json");
    next.revision += 1;
    next.flat_files = { [file]: await sha256Hex(csv) };
    const text = JSON.stringify(next);
    const index = { schema: RELEASE_INDEX_SCHEMA, release: next.release, budget: next.budget, manifest_revision: next.revision, manifest_sha256: await sha256Hex(text), files: next.flat_files, aliases: {} };
    const overrides = { "manifest.json": text, "release-index.json": JSON.stringify(index), [file]: csv };
    await expect(loadVerifiedFlat(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) })).rejects.toBeInstanceOf(SnapshotChangedError);
  });

  it("still fails as unavailable when only the index is wrong", async () => {
    const { SnapshotChangedError } = await import("./flat");
    const { manifest, index, overrides } = await flatSnapshot();
    index.manifest_revision += 1;
    overrides["release-index.json"] = JSON.stringify(index);
    const failure = await loadVerifiedFlat(file, { manifest }, { basePath: BASE_PATH, fetchImpl: fixtureFetch({ overrides }) }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SnapshotChangedError);
  });
});

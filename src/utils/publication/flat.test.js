import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fixtureFetch, fixtureJson, fixtureText, BASE_PATH, IN_DATA } from "../../test/publicationFixture";
import { loadManifest } from "./load";
import { sha256Hex } from "./digest";
import { loadVerifiedFlatCsv, RELEASE_INDEX_SCHEMA } from "./flat";
import { budgetChartData, loadDashboard } from "../loadDashboard";

const file = "age_impact.csv";
const csv = "reform_id,reform_name,year,value\nalpha,Alpha,2032,12\n";

async function flatSnapshot() {
  const manifest = fixtureJson("manifest.json");
  manifest.flat_files = { [file]: await sha256Hex(csv) };
  const text = JSON.stringify(manifest);
  const index = { schema: RELEASE_INDEX_SCHEMA, release: manifest.release, budget: manifest.budget, manifest_revision: manifest.revision, manifest_sha256: await sha256Hex(text), files: manifest.flat_files };
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

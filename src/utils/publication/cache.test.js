import { describe, expect, it } from "vitest";
import { cachedFile, rememberFile } from "./cache";
import { sha256Hex } from "./digest";
import { CATALOGUE_TABLES, loadArtifact, loadPublication } from "./load";
import { loadDashboard, loadVerifiedTablesOnce, peekVerifiedTables } from "../loadDashboard";
import { BASE_PATH, fixtureFetch, fixtureJson, fixtureText } from "../../test/publicationFixture";

const manifest = fixtureJson("manifest.json");
const alpha = manifest.measures.alpha;

describe("loading in parallel", () => {
  it("requests every artifact's receipt before any one of them has answered", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const delays = {};
    for (const key of ["alpha", "beta"]) delays[`${manifest.measures[key].artifact}/receipt.json`] = gate;
    delays[`${manifest.combined["combined--alpha+beta"].artifact}/receipt.json`] = gate;
    const fetchImpl = fixtureFetch({ delays });
    const loading = loadPublication(BASE_PATH, ["alpha", "beta"], { fetchImpl, tables: CATALOGUE_TABLES });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const receipts = fetchImpl.calls.filter((url) => url.endsWith("/receipt.json"));
    expect(receipts).toHaveLength(3);
    expect(fetchImpl.calls.some((url) => url.endsWith(".csv"))).toBe(false);
    release();
    const result = await loading;
    expect(Object.keys(result.tablesByKey).sort()).toEqual(["alpha", "beta", "combined--alpha+beta"]);
  });

  it("waits for no household scatter before the first chart", async () => {
    const fetchImpl = fixtureFetch();
    const loaded = await loadDashboard(BASE_PATH, { fetchImpl });
    expect(loaded.budgetary.length).toBeGreaterThan(0);
    expect(fetchImpl.calls.some((url) => url.endsWith("/household_scatter_binned.csv"))).toBe(false);
  });
});

describe("verified bytes kept by digest", () => {
  it("answers a repeat load of an artifact with no request", async () => {
    const fetchImpl = fixtureFetch();
    const first = await loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl });
    const before = fetchImpl.calls.length;
    const second = await loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl });
    expect(fetchImpl.calls.length).toBe(before);
    expect(second.budgetary_impact).toEqual(first.budgetary_impact);
  });

  it("reads a view's later table through the receipt already verified, with no receipt request", async () => {
    const fetchImpl = fixtureFetch();
    const loaded = await loadDashboard(BASE_PATH, { fetchImpl });
    const receipts = fetchImpl.calls.filter((url) => url.endsWith("/receipt.json")).length;
    const { rows } = await loadVerifiedTablesOnce(loaded.catalogue, "household_scatter_binned", { basePath: BASE_PATH, fetchImpl });
    expect(rows.length).toBeGreaterThan(0);
    expect(fetchImpl.calls.filter((url) => url.endsWith("/receipt.json")).length).toBe(receipts);
    // Shared: a second view gets the same result at once
    expect(peekVerifiedTables(loaded.catalogue, "household_scatter_binned").rows).toBe(rows);
  });

  it("drops a kept copy whose bytes no longer hash to its digest", async () => {
    const scope = () => {};
    const bytes = new TextEncoder().encode("figures");
    const digest = await sha256Hex(bytes);
    rememberFile(digest, new TextEncoder().encode("other figures"), scope);
    expect(await cachedFile(digest, scope)).toBeNull();
    rememberFile(digest, bytes, scope);
    expect(await cachedFile(digest, scope)).toEqual(bytes);
  });

  it("still refuses a file that does not match its receipt, and keeps nothing of it", async () => {
    const file = `${alpha.artifact}/budgetary_impact.csv`;
    const fetchImpl = fixtureFetch({ overrides: { [file]: `${fixtureText(file)}\n` } });
    await expect(loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl })).rejects.toThrow(/does not match its receipt/);
    // Asked again, it is fetched and refused again: no copy was kept
    await expect(loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl })).rejects.toThrow(/does not match its receipt/);
    expect(fetchImpl.calls.filter((url) => url.endsWith("/budgetary_impact.csv"))).toHaveLength(2);
  });

  it("runs every receipt check on a kept receipt", async () => {
    const fetchImpl = fixtureFetch();
    await loadArtifact(BASE_PATH, "alpha", alpha, { fetchImpl });
    // The same receipt, kept, under an entry that names other years
    const edited = { ...alpha, years: [...alpha.years, 2099] };
    await expect(loadArtifact(BASE_PATH, "alpha", edited, { fetchImpl })).rejects.toThrow(/years/);
  });
});

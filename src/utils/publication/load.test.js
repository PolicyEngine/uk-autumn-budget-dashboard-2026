// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadPublication } from "./load";
import {
  BASE_PATH,
  fixtureFetch,
  fixtureJson,
  fixtureText,
  IN_DATA,
} from "../../test/publicationFixture";

const manifest = fixtureJson("manifest.json");
const alpha = manifest.measures.alpha.artifact;

describe("loadPublication", () => {
  it("loads and verifies the selection's artifacts and its combined run", async () => {
    const fetchImpl = fixtureFetch();
    const result = await loadPublication(BASE_PATH, ["beta", "alpha"], {
      fetchImpl,
    });
    expect(result.status).toBe("ready");
    expect(result.failures).toEqual({});
    expect(Object.keys(result.tablesByKey).sort()).toEqual([
      "alpha",
      "beta",
      "combined--alpha+beta",
    ]);
    expect(result.tablesByKey.alpha.budgetary_impact[0]).toEqual({
      reform_id: "alpha",
      reform_name: "Alpha",
      year: IN_DATA,
      value: -1.1,
    });
    expect(result.selection).toEqual(["alpha", "beta"]);
  });

  it("never fetches a staged measure's files", async () => {
    const fetchImpl = fixtureFetch();
    const result = await loadPublication(BASE_PATH, ["delta"], { fetchImpl });
    expect(result.tablesByKey).toEqual({});
    expect(fetchImpl.calls.some((url) => url.includes("/delta/"))).toBe(false);
  });

  it("never fetches a not-computable measure's files", async () => {
    const fetchImpl = fixtureFetch();
    const result = await loadPublication(BASE_PATH, ["epsilon"], {
      fetchImpl,
    });
    expect(result.tablesByKey).toEqual({});
    expect(fetchImpl.calls.some((url) => url.includes("/epsilon/"))).toBe(
      false,
    );
  });

  it("reports no manifest when none is published", async () => {
    const fetchImpl = fixtureFetch({ overrides: { "manifest.json": 404 } });
    const result = await loadPublication(BASE_PATH, ["alpha"], { fetchImpl });
    expect(result.status).toBe("no-manifest");
  });

  it("fails on a manifest it cannot trust", async () => {
    const broken = { ...manifest, schema: "other/v1" };
    const fetchImpl = fixtureFetch({
      overrides: { "manifest.json": JSON.stringify(broken) },
    });
    await expect(
      loadPublication(BASE_PATH, ["alpha"], { fetchImpl }),
    ).rejects.toThrow(/invalid/);
  });

  it("fails when the manifest cannot be fetched", async () => {
    const fetchImpl = fixtureFetch({ overrides: { "manifest.json": 500 } });
    await expect(
      loadPublication(BASE_PATH, ["alpha"], { fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("leaves out a tampered artifact and says why", async () => {
    const tampered = fixtureText(`${alpha}/budgetary_impact.csv`).replace(
      "-1.1",
      "-9.1",
    );
    const fetchImpl = fixtureFetch({
      overrides: { [`${alpha}/budgetary_impact.csv`]: tampered },
    });
    const result = await loadPublication(BASE_PATH, ["alpha", "beta"], {
      fetchImpl,
    });
    expect(result.status).toBe("ready");
    expect(result.tablesByKey.alpha).toBeUndefined();
    expect(result.failures.alpha).toMatch(/budgetary_impact.csv/);
    expect(result.tablesByKey.beta).toBeDefined();
  });

  it("leaves out an artifact whose receipt is not the manifest's", async () => {
    const beta = manifest.measures.beta.artifact;
    const fetchImpl = fixtureFetch({
      overrides: {
        [`${alpha}/receipt.json`]: fixtureText(`${beta}/receipt.json`),
      },
    });
    const result = await loadPublication(BASE_PATH, ["alpha"], { fetchImpl });
    expect(result.tablesByKey.alpha).toBeUndefined();
    expect(result.failures.alpha).toMatch(
      /not the artifact the manifest names/,
    );
  });

  it("leaves out an artifact whose receipt was edited", async () => {
    const receipt = fixtureJson(`${alpha}/receipt.json`);
    receipt.dashboard.tree_clean = false;
    const fetchImpl = fixtureFetch({
      overrides: { [`${alpha}/receipt.json`]: JSON.stringify(receipt) },
    });
    const result = await loadPublication(BASE_PATH, ["alpha"], { fetchImpl });
    expect(result.tablesByKey.alpha).toBeUndefined();
    expect(result.failures.alpha).toMatch(
      /not the artifact the manifest names/,
    );
  });

  it("leaves out an artifact with a missing file", async () => {
    const fetchImpl = fixtureFetch({
      overrides: { [`${alpha}/metrics.csv`]: 404 },
    });
    const result = await loadPublication(BASE_PATH, ["alpha"], { fetchImpl });
    expect(result.failures.alpha).toMatch(/HTTP 404/);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadPublication(BASE_PATH, ["alpha"], {
        fetchImpl: fixtureFetch(),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });
});

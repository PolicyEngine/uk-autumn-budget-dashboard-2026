// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadArtifact, loadPublication, unverifiedMembers } from "./load";
import { fiscalSeries } from "./select";
import {
  BASE_PATH,
  FIXTURE_ROOT,
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

  it("has only a receipt, binding no files, for a not-computable measure", () => {
    const entry = manifest.measures.epsilon;
    expect(readdirSync(join(FIXTURE_ROOT, entry.artifact))).toEqual([
      "receipt.json",
    ]);
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.files).toEqual({});
    expect(receipt.dashboard.name).toBe(entry.name);
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

  it("refuses a data-limited artifact relabelled to show figures", async () => {
    // Review of #51: a manifest edited by hand to approve epsilon and drop
    // its data limits. Its receipt still records them, so no figure loads.
    const edited = structuredClone(manifest);
    Object.assign(edited.measures.epsilon, {
      status: "approved",
      data_limits: [],
    });
    delete edited.measures.epsilon.reason;
    const fetchImpl = fixtureFetch({
      overrides: { "manifest.json": JSON.stringify(edited) },
    });
    const result = await loadPublication(BASE_PATH, ["epsilon"], {
      fetchImpl,
    });
    expect(result.tablesByKey.epsilon).toBeUndefined();
    expect(result.failures.epsilon).toMatch(/records data limits/);
    expect(
      fetchImpl.calls.some(
        (url) => url.includes("/epsilon/") && url.endsWith(".csv"),
      ),
    ).toBe(false);
  });

  it.each([
    ["zeta", 0.9],
    ["eta", 1.1],
  ])("loads %s's model-limited figures as provisional", async (key, value) => {
    const fetchImpl = fixtureFetch();
    const result = await loadPublication(BASE_PATH, [key], { fetchImpl });
    expect(result.failures).toEqual({});
    expect(result.tablesByKey[key].budgetary_impact[0].value).toBe(value);
  });

  it.each(["zeta", "eta"])(
    "refuses %s's model-limited artifact relabelled as approved",
    async (key) => {
      // A manifest edited by hand to approve either model-limited measure
      // cannot make its figures load while its receipt records the limit.
      const edited = structuredClone(manifest);
      edited.measures[key].status = "approved";
      const fetchImpl = fixtureFetch({
        overrides: { "manifest.json": JSON.stringify(edited) },
      });
      const result = await loadPublication(BASE_PATH, [key], { fetchImpl });
      expect(result.tablesByKey[key]).toBeUndefined();
      expect(result.failures[key]).toMatch(/records model limits/);
      expect(
        fetchImpl.calls.some(
          (url) => url.includes(`/${key}/`) && url.endsWith(".csv"),
        ),
      ).toBe(false);
    },
  );

  it("shows no combined figure when a member fails verification", async () => {
    // Review of #51 round 2: a member whose receipt was refused (there, one
    // recording a data limit) left its combined run's figure on the page.
    const beta = manifest.measures.beta.artifact;
    const fetchImpl = fixtureFetch({
      overrides: {
        [`${alpha}/receipt.json`]: fixtureText(`${beta}/receipt.json`),
      },
    });
    const result = await loadPublication(BASE_PATH, ["alpha", "beta"], {
      fetchImpl,
    });
    expect(result.tablesByKey.alpha).toBeUndefined();
    expect(result.tablesByKey["combined--alpha+beta"]).toBeUndefined();
    expect(result.failures["combined--alpha+beta"]).toMatch(
      /member alpha did not verify/,
    );
    const series = fiscalSeries({
      ...result,
      selectedIds: ["alpha", "beta"],
      years: [IN_DATA],
    });
    expect(series.every((point) => point.combined === null)).toBe(true);
  });

  it("keys its tables and failures with no prototype", async () => {
    const result = await loadPublication(BASE_PATH, ["alpha", "beta"], {
      fetchImpl: fixtureFetch(),
    });
    expect(Object.getPrototypeOf(result.tablesByKey)).toBeNull();
    expect(Object.getPrototypeOf(result.failures)).toBeNull();
    expect(result.tablesByKey.constructor).toBeUndefined();
    expect(result.failures.toString).toBeUndefined();
  });

  it("never loads a not-computable entry's artifact, even when asked", async () => {
    const fetchImpl = fixtureFetch();
    await expect(
      loadArtifact(BASE_PATH, "epsilon", manifest.measures.epsilon, {
        fetchImpl,
      }),
    ).rejects.toThrow(/not_computable: its figures are not shown/);
    expect(fetchImpl.calls).toEqual([]);
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

describe("unverifiedMembers", () => {
  it("finds a member named like an object property that did not load", () => {
    // Review of #51 round 5: `constructor in tablesByKey` held through the
    // prototype, so a refused member named constructor kept its combined
    // run's figure on the page.
    const tablesByKey = { "combined--beta+constructor": {}, beta: {} };
    expect(unverifiedMembers(["beta", "constructor"], tablesByKey)).toEqual([
      "constructor",
    ]);
    const names = ["toString", "hasOwnProperty", "__proto__", "valueOf"];
    expect(unverifiedMembers(names, {})).toEqual(names);
    expect(unverifiedMembers(names, Object.create(null))).toEqual(names);
  });

  it("finds none when every member loaded", () => {
    const tablesByKey = Object.create(null);
    tablesByKey.constructor = {};
    tablesByKey.beta = {};
    expect(unverifiedMembers(["beta", "constructor"], tablesByKey)).toEqual([]);
  });
});

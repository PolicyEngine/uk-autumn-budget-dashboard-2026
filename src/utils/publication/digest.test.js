// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import {
  artifactSha256,
  dropNulls,
  jcsSha256,
  receiptProblems,
  sha256Hex,
  verifyFile,
  verifyReceiptFiles,
} from "./digest";
import {
  fixtureBytes,
  fixtureJson,
  IN_DATA,
} from "../../test/publicationFixture";

const manifest = fixtureJson("manifest.json");
const entries = { ...manifest.measures, ...manifest.combined };

describe("sha256Hex", () => {
  it("matches the standard empty-string digest", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes strings as UTF-8", async () => {
    expect(await sha256Hex("é")).toBe(
      await sha256Hex(new Uint8Array([0xc3, 0xa9])),
    );
  });
});

describe("dropNulls", () => {
  it("drops null members at every depth and keeps array elements", () => {
    expect(
      dropNulls({ a: null, b: [null, { c: null, d: 1 }], e: { f: null } }),
    ).toEqual({ b: [null, { d: 1 }], e: {} });
  });
});

describe("jcsSha256 against policyengine's receipt code", () => {
  // Differential: contract.json's vectors are computed by the Python
  // receipt code (uk_budget_data.publication.contract).
  it.each(contract.digest_vectors.map((v, i) => [i, v]))(
    "vector %i",
    async (_, vector) => {
      expect(await jcsSha256(vector.value)).toBe(vector.sha256);
    },
  );
});

describe("verifying the fixture's artifacts", () => {
  it.each(Object.entries(entries))("%s", async (key, entry) => {
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.key).toBe(key);
    expect(await verifyReceiptFiles(receipt, entry)).toBe(true);
    for (const name of Object.keys(receipt.dashboard.files)) {
      const bytes = fixtureBytes(`${entry.artifact}/${name}`);
      expect(await verifyFile(name, bytes, receipt)).toBe(true);
    }
  });

  it("refuses a receipt whose files are not the entry's", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entries.beta.artifact}/receipt.json`);
    expect(await verifyReceiptFiles(receipt, entry)).toBe(false);
  });

  it("refuses a file the receipt does not list", async () => {
    const receipt = fixtureJson(`${entries.alpha.artifact}/receipt.json`);
    expect(await verifyFile("extra.csv", "x", receipt)).toBe(false);
  });

  it("rejects any single-character change to a file", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    const names = Object.keys(receipt.dashboard.files);
    const files = Object.fromEntries(
      names.map((name) => [name, fixtureBytes(`${entry.artifact}/${name}`)]),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...names),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        async (name, at, delta) => {
          const bytes = files[name].slice();
          const index = at % bytes.length;
          bytes[index] = (bytes[index] + delta) % 256;
          expect(await verifyFile(name, bytes, receipt)).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("binding a receipt to its manifest entry", () => {
  // Differential: the manifest's artifact digests were computed by Python.
  it.each(Object.entries(entries))(
    "%s: the browser computes the manifest's artifact digest",
    async (key, entry) => {
      const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
      expect(await artifactSha256(receipt)).toBe(entry.artifact_sha256);
      // A not-computable entry's receipt binds, but records data limits,
      // so it is never loaded for its figures.
      const expected = entry.data_limits?.length
        ? [
            "the receipt records data limits: not computable on current " +
              "data, so its figures cannot be shown",
          ]
        : [];
      expect(await receiptProblems(receipt, key, entry)).toEqual(expected);
    },
  );

  it("refuses a receipt generated against another data-limit registry", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    receipt.dashboard.data_limits_registry_sha256 = "0".repeat(64);
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt was generated against another data-limit registry",
    );
  });

  it("refuses a receipt that does not record its data limits", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    delete receipt.dashboard.data_limits;
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt does not record its data limits",
    );
  });

  it("refuses a receipt generated against another model-limit registry", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    receipt.dashboard.model_limits_registry_sha256 = "0".repeat(64);
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt was generated against another model-limit registry",
    );
  });

  it("refuses a receipt that does not record its model limits", async () => {
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    delete receipt.dashboard.model_limits;
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt does not record its model limits",
    );
  });

  it("shows a model-limited receipt as provisional, never as approved", async () => {
    // zeta's receipt records the State Pension's model limit. As staged,
    // provisional, it binds; relabelled approved by hand, it is refused.
    const entry = structuredClone(entries.zeta);
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.model_limits).toHaveLength(1);
    expect(entry.status).toBe("provisional");
    expect(await receiptProblems(receipt, "zeta", entry)).toEqual([]);
    entry.status = "approved";
    expect(await receiptProblems(receipt, "zeta", entry)).toEqual([
      "the receipt records model limits: held at provisional, so it " +
        "cannot be shown as approved",
    ]);
  });

  it("refuses a combined entry relabelled with other members", async () => {
    // Review case: relabel alpha+beta as alpha+gamma, with a matching
    // snapshot, keeping the artifact and every other digest.
    const key = "combined--alpha+beta";
    const entry = structuredClone(entries[key]);
    entry.measures = ["alpha", "gamma"];
    entry.member_outputs_sha256 = {
      alpha: entries.alpha.outputs_sha256,
      gamma: entries.gamma.outputs_sha256,
    };
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    const problems = await receiptProblems(receipt, key, entry);
    expect(problems).toContain("the receipt's members are not the manifest's");
    expect(problems).toContain(
      "the receipt's member outputs are not the manifest's",
    );
  });

  it.each([
    ["unsupported_years", [], "the receipt's unsupported years"],
    ["years", [IN_DATA], "the receipt's years"],
  ])(
    "refuses an entry whose %s differ from its receipt",
    async (field, value, message) => {
      // Review case: clearing unsupported_years would show the row for the
      // year beyond the data.
      const entry = structuredClone(entries.alpha);
      entry[field] = value;
      const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
      const problems = await receiptProblems(receipt, "alpha", entry);
      expect(problems.some((problem) => problem.startsWith(message))).toBe(
        true,
      );
    },
  );

  it("refuses a receipt edited outside its file list", async () => {
    // Review case: tree_clean and publishable changed, files unchanged.
    const entry = entries.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    receipt.dashboard.tree_clean = false;
    receipt.dashboard.publishable = false;
    expect(await verifyReceiptFiles(receipt, entry)).toBe(true);
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt is not the artifact the manifest names",
    );
  });
});

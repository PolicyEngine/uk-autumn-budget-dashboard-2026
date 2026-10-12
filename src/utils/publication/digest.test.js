// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import {
  dropNulls,
  jcsSha256,
  sha256Hex,
  verifyFile,
  verifyReceiptFiles,
} from "./digest";
import { fixtureBytes, fixtureJson } from "../../test/publicationFixture";

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

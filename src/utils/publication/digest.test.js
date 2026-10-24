// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import {
  artifactSha256,
  dropNulls,
  jcsSha256,
  modifierTemplatesProblems,
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

async function handwritten(key = "alpha", side = "reform") {
  const entry = structuredClone(entries[key]);
  const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
  receipt.dashboard.modifier_templates = { baseline: [], reform: [] };
  receipt.dashboard.modifier_templates[side] = [null];
  receipt.dashboard.generation_id = "a".repeat(32);
  receipt.execution_receipt[side].binding = "code_revision";
  receipt.execution_receipt[side].representation =
    "policyengine-uk.scenario/v1";
  entry.artifact_sha256 = await artifactSha256(receipt);
  return { entry, receipt };
}

async function attest(key, receipt) {
  return {
    measure_id: key,
    receipt_sha256: await jcsSha256(receipt),
    reason: "The modifier only changes the registered allowance calculation.",
    checker: "First reviewer",
    second: "Second reviewer",
    released_at: "2026-10-22T12:00:00+00:00",
  };
}

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
  const withFigures = Object.entries(entries).filter(
    ([, entry]) => entry.status !== "not_computable",
  );

  it.each(withFigures)("%s", async (key, entry) => {
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.key).toBe(key);
    expect(await verifyReceiptFiles(receipt, entry)).toBe(true);
    for (const name of Object.keys(receipt.dashboard.files)) {
      const bytes = fixtureBytes(`${entry.artifact}/${name}`);
      expect(await verifyFile(name, bytes, receipt)).toBe(true);
    }
  });

  it("binds no files for a not-computable entry, so none can verify", async () => {
    // Its artifact is its receipt alone: the outputs digest is that of the
    // empty file map, and no file can pass step 1.
    const entry = entries.epsilon;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.files).toEqual({});
    expect(await jcsSha256({})).toBe(entry.outputs_sha256);
    expect(await artifactSha256(receipt)).toBe(entry.artifact_sha256);
    expect(await verifyReceiptFiles(receipt, entry)).toBe(false);
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
  it.each(["name", "description"])("binds the public %s to the receipt", async (field) => {
    const entry = { ...entries.alpha, [field]: "Altered public text" };
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      `the receipt's ${field} is not the manifest's`,
    );
  });

  it("accepts matching public descriptions covered by the artifact digest", async () => {
    const receipt = fixtureJson(`${entries.alpha.artifact}/receipt.json`);
    receipt.dashboard.description = "A newly announced measure.";
    const entry = {
      ...entries.alpha,
      description: receipt.dashboard.description,
      artifact_sha256: await artifactSha256(receipt),
    };
    expect(await receiptProblems(receipt, "alpha", entry)).toEqual([]);
  });

  it("rejects a receipt with a non-text description", async () => {
    const receipt = fixtureJson(`${entries.alpha.artifact}/receipt.json`);
    receipt.dashboard.description = null;
    const entry = { ...entries.alpha, artifact_sha256: await artifactSha256(receipt) };
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt's description is not text",
    );
  });

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

  it.each([
    ["zeta", "state_pension_add_on_uprating"],
    ["eta", "benefit_uprating_september_cpi"],
    ["theta", "pc_minimum_guarantee_uprating"],
    ["iota", "vat_consumption_coverage"],
  ])(
    "shows %s's model-limited receipt as provisional, never as approved",
    async (key, limit) => {
      // Real receipts for each registered limit bind as provisional;
      // relabelled approved by hand, each is refused.
      const entry = structuredClone(entries[key]);
      const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
      expect(receipt.dashboard.model_limits).toHaveLength(1);
      expect(receipt.dashboard.model_limits[0].key).toBe(limit);
      expect(entry.status).toBe("provisional");
      expect(await receiptProblems(receipt, key, entry)).toEqual([]);
      entry.status = "approved";
      expect(await receiptProblems(receipt, key, entry)).toEqual([
        "the receipt records model limits: held at provisional, so it " +
          "cannot be shown as approved",
      ]);
    },
  );

  it.each(["zeta", "eta", "theta", "iota"])(
    "refuses an approved combined run recording %s's model limit",
    async (limitedKey) => {
      // A combined run's own receipt can record a limit no member records
      // (the combination touches it); it is held at provisional like any
      // measure. The edited receipt no longer matches its digest either.
      const key = "combined--alpha+beta";
      const entry = entries[key];
      expect(entry.status).toBe("approved");
      const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
      receipt.dashboard.model_limits = [
        fixtureJson(`${entries[limitedKey].artifact}/receipt.json`).dashboard
          .model_limits[0],
      ];
      expect(await receiptProblems(receipt, key, entry)).toContain(
        "the receipt records model limits: held at provisional, so it " +
          "cannot be shown as approved",
      );
    },
  );

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

describe("the automatic modifier hold", () => {
  it("checks the fixture's attestation using Python's full receipt digest", async () => {
    const entry = entries.delta;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(receipt.dashboard.modifier_templates.reform).toEqual([null]);
    expect(await jcsSha256(receipt)).toBe(entry.attestation.receipt_sha256);
    expect(await receiptProblems(receipt, "delta", entry)).toEqual([]);
  });

  it.each(["baseline", "reform"])(
    "holds a hand-written %s modifier without an attestation",
    async (side) => {
      const { entry, receipt } = await handwritten("alpha", side);
      const problems = await receiptProblems(receipt, "alpha", entry);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^held: a hand-written modifier/);
      expect(problems[0]).toContain("attestations/alpha.json");
    },
  );

  it.each(["staged", "provisional", "approved"])(
    "a valid attestation releases a held modifier at %s",
    async (status) => {
      const { entry, receipt } = await handwritten();
      entry.status = status;
      entry.attestation = await attest("alpha", receipt);
      expect(await receiptProblems(receipt, "alpha", entry)).toEqual([]);
    },
  );

  it("binds release to the full receipt, including every regeneration", async () => {
    const { entry, receipt } = await handwritten();
    entry.attestation = await attest("alpha", receipt);
    receipt.dashboard.generated_at = "2026-10-22T12:00:01+00:00";
    // Timestamp changes deliberately leave the stable artifact digest alone.
    expect(await artifactSha256(receipt)).toBe(entry.artifact_sha256);
    expect(await receiptProblems(receipt, "alpha", entry)).toEqual([
      expect.stringMatching(/^held: a hand-written modifier/),
    ]);
  });

  it.each([
    ["another receipt", (a) => (a.receipt_sha256 = "0".repeat(64))],
    ["another measure", (a) => (a.measure_id = "beta")],
    ["the same reviewer twice", (a) => (a.second = " FIRST REVIEWER ")],
    [
      "Unicode-equivalent names",
      (a) => {
        a.checker = "Straße";
        a.second = "STRASSE";
      },
    ],
    ["an empty reviewer", (a) => (a.checker = "\u0085 ")],
    ["an empty reason", (a) => (a.reason = " ")],
    ["a date without a time", (a) => (a.released_at = "2026-10-22")],
    [
      "a time without a timezone",
      (a) => (a.released_at = "2026-10-22T12:00:00"),
    ],
    ["an invalid timestamp", (a) => (a.released_at = "not a timestamp")],
    [
      "a timestamp before Python's UTC range",
      (a) => (a.released_at = "0001-01-01T00:00:00+23:59"),
    ],
    [
      "a timestamp after Python's UTC range",
      (a) => (a.released_at = "9999-12-31T23:59:59-23:59"),
    ],
  ])("does not release with %s", async (_, change) => {
    const { entry, receipt } = await handwritten();
    entry.attestation = await attest("alpha", receipt);
    change(entry.attestation);
    expect(await receiptProblems(receipt, "alpha", entry)).toContainEqual(
      expect.stringMatching(/^held: a hand-written modifier/),
    );
  });

  it("accepts a recorded pure-template proof", async () => {
    const { entry, receipt } = await handwritten();
    receipt.dashboard.modifier_templates.reform = [
      [contract.measure_templates[0]],
    ];
    entry.artifact_sha256 = await artifactSha256(receipt);
    expect(await receiptProblems(receipt, "alpha", entry)).toEqual([]);
  });

  it.each([
    undefined,
    null,
    [],
    { baseline: [] },
    { baseline: [], reform: [], extra: [] },
    { baseline: [], reform: null },
    { baseline: [], reform: [[]] },
    { baseline: [], reform: [["unregistered_template"]] },
    {
      baseline: [],
      reform: [[contract.measure_templates[0], contract.measure_templates[0]]],
    },
  ])("refuses an absent or malformed template proof: %j", async (proof) => {
    const { receipt } = await handwritten();
    receipt.dashboard.modifier_templates = proof;
    expect(modifierTemplatesProblems(receipt).length).toBeGreaterThan(0);
  });

  it("refuses to omit the proof of a bound modifier", async () => {
    const { entry, receipt } = await handwritten();
    receipt.dashboard.modifier_templates.reform = [];
    entry.artifact_sha256 = await artifactSha256(receipt);
    expect(await receiptProblems(receipt, "alpha", entry)).toContain(
      "the receipt's reform modifier templates do not match its bound modifiers",
    );
  });

  it.each([undefined, null, "", "a".repeat(31), "a".repeat(32) + "\n", 1])(
    "refuses a hand-written receipt without a valid generation id: %j",
    async (generationId) => {
      const { receipt } = await handwritten();
      receipt.dashboard.generation_id = generationId;
      expect(modifierTemplatesProblems(receipt)).toContain(
        "the receipt's hand-written generation id is malformed",
      );
    },
  );

  it("holds a combined receipt with a hand-written member", async () => {
    const key = "combined--alpha+beta";
    const { entry, receipt } = await handwritten(key);
    receipt.dashboard.members[0].reform.binding = "code_revision";
    receipt.dashboard.members[0].reform.representation =
      "policyengine-uk.scenario/v1";
    entry.artifact_sha256 = await artifactSha256(receipt);
    expect(await receiptProblems(receipt, key, entry)).toContainEqual(
      expect.stringMatching(/^held: a hand-written modifier/),
    );
  });

  it("disables the automatic hold with an empty active-limit registry", async () => {
    const { entry, receipt } = await handwritten();
    const active = contract.data_limits_active;
    try {
      contract.data_limits_active = false;
      expect(await receiptProblems(receipt, "alpha", entry)).toEqual([]);
    } finally {
      contract.data_limits_active = active;
    }
  });
});

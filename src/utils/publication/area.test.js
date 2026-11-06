import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  areaReceiptTarget,
  assertAreaProvenance,
  assertAreaProvenanceDocument,
  assertAreaReceipt,
  AREA_PROVENANCE_SCHEMA,
  AREA_PROVENANCE_SCHEMA_V1,
} from "./area";

const CODE_BOUND = { kind: "reform", representation: "policyengine-uk.scenario/v1", reform_sha256: "1".repeat(64), binding: "code_revision" };

function snapshot({ v1 = false } = {}) {
  const entry = { status: "approved", artifact: "artifacts/package", artifact_sha256: "a".repeat(64), receipt_sha256: "b".repeat(64), outputs_sha256: "c".repeat(64), execution_identity_sha256: "d".repeat(64) };
  const record = { ...entry, key: "package", execution_identity_sha256: "d".repeat(64), baseline: { kind: "current_law", representation: null, reform_sha256: null, binding: "content" }, reform: { kind: "reform", representation: "policyengine-uk.scenario/v1", reform_sha256: "f".repeat(64), binding: "content" } };
  delete record.status;
  if (!v1) record.definition = { baseline: null, reform: "f".repeat(64) };
  const manifest = { measures: { alpha: { ...entry, artifact: "artifacts/alpha" } }, combined: { package: entry } };
  const files = { "regional.csv": "e".repeat(64) };
  const document = { schema: v1 ? AREA_PROVENANCE_SCHEMA_V1 : AREA_PROVENANCE_SCHEMA, manifest_revision: 1, manifest_sha256: "a".repeat(64), files, reforms: { package_alias: record } };
  if (!v1) document.runs = { "regional.csv": { git_sha: "0123456789abcdef0123456789abcdef01234567", years: [2026, 2027], dataset: { kind: "local_area_cut", name: "cut", sha256: "9".repeat(64) } } };
  return { manifest, files, document, aliases: { package_alias: "package" } };
}

const check = ({ document, manifest, files, aliases }) => assertAreaProvenance(document, manifest, files, aliases);

function approvedReceipt(record) {
  return {
    execution_receipt: {
      baseline: { kind: "current_law", binding: "content", name: "Approved baseline" },
      reform: { ...record.reform, name: "Approved reform" },
    },
    dashboard: {
      key: record.key,
      digests: Object.fromEntries(["receipt_sha256", "outputs_sha256", "execution_identity_sha256"].map((field) => [field, record[field]])),
    },
  };
}

describe("area receipt execution identities (v1: the receipt the area run read)", () => {
  const v1Record = () => snapshot({ v1: true }).document.reforms.package_alias;

  it("normalises missing optional receipt fields and ignores display names", () => {
    const record = v1Record();
    expect(() => assertAreaReceipt(record, approvedReceipt(record), AREA_PROVENANCE_SCHEMA_V1)).not.toThrow();
  });

  it("refuses changed baseline or reform hashes with unchanged approved output bytes", () => {
    fc.assert(fc.property(
      fc.constantFrom("baseline", "reform"),
      fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 }).map((digits) => digits.map((digit) => digit.toString(16)).join("")),
      (side, digest) => {
        const record = v1Record();
        record.baseline = { ...record.reform, reform_sha256: "e".repeat(64) };
        const receipt = approvedReceipt(record);
        receipt.execution_receipt.baseline = { ...record.baseline, name: "Approved baseline" };
        fc.pre(digest !== record[side].reform_sha256);
        record[side].reform_sha256 = digest;
        expect(record.outputs_sha256).toBe(receipt.dashboard.digests.outputs_sha256);
        expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA_V1)).toThrow(/identity differs/);
      },
    ));
  });

  it("refuses a code-bound digest made at another commit", () => {
    const record = { ...v1Record(), reform: CODE_BOUND };
    const receipt = approvedReceipt(record);
    receipt.execution_receipt.reform.reform_sha256 = "2".repeat(64);
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA_V1)).toThrow(/reform identity differs/);
  });

  it.each(["key", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"])("refuses a changed receipt %s", (field) => {
    const record = v1Record();
    const receipt = approvedReceipt(record);
    if (field === "key") receipt.dashboard.key = "another-entry";
    else receipt.dashboard.digests[field] = "0".repeat(64);
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA_V1)).toThrow(/approved receipt/);
  });

  it.each(["kind", "representation", "binding"])("refuses a changed reform %s", (field) => {
    const record = v1Record();
    const receipt = approvedReceipt(record);
    receipt.execution_receipt.reform[field] = "another-value";
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA_V1)).toThrow(/reform identity differs/);
  });
});

describe("area receipt definitions (v2: the current approved receipt)", () => {
  const v2Record = () => snapshot().document.reforms.package_alias;

  it("accepts a national rerun: new receipt, outputs and execution identity, same definition", () => {
    const record = v2Record();
    const receipt = approvedReceipt(record);
    for (const field of ["receipt_sha256", "outputs_sha256", "execution_identity_sha256"]) receipt.dashboard.digests[field] = "0".repeat(64);
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA)).not.toThrow();
  });

  it("accepts a code-bound receipt made at a later commit (the gate checks the code)", () => {
    const record = { ...v2Record(), reform: CODE_BOUND, definition: { baseline: null, reform: "3".repeat(64) } };
    const receipt = approvedReceipt(record);
    receipt.execution_receipt.reform.reform_sha256 = "2".repeat(64);
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA)).not.toThrow();
  });

  it("refuses a changed content-bound definition", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 }).map((digits) => digits.map((digit) => digit.toString(16)).join("")),
      (digest) => {
        const record = v2Record();
        const receipt = approvedReceipt(record);
        fc.pre(digest !== record.reform.reform_sha256);
        receipt.execution_receipt.reform.reform_sha256 = digest;
        expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA)).toThrow(/reform identity differs/);
      },
    ));
  });

  it.each(["kind", "representation", "binding"])("refuses a changed reform %s", (field) => {
    const record = v2Record();
    const receipt = approvedReceipt(record);
    receipt.execution_receipt.reform[field] = "another-value";
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA)).toThrow(/reform identity differs/);
  });

  it("refuses a receipt for another entry", () => {
    const record = v2Record();
    const receipt = approvedReceipt(record);
    receipt.dashboard.key = "another-entry";
    expect(() => assertAreaReceipt(record, receipt, AREA_PROVENANCE_SCHEMA)).toThrow(/approved receipt/);
  });

  it("reads the receipt of the entry's current artifact, not the one the area run read", () => {
    const data = snapshot();
    data.manifest.combined.package.artifact = "artifacts/package-rerun";
    data.manifest.combined.package.artifact_sha256 = "5".repeat(64);
    expect(areaReceiptTarget(data.document, data.document.reforms.package_alias, data.manifest))
      .toEqual({ artifact: "artifacts/package-rerun", artifactSha256: "5".repeat(64) });
    const v1 = snapshot({ v1: true });
    v1.manifest.combined.package.artifact = "artifacts/package-rerun";
    expect(areaReceiptTarget(v1.document, v1.document.reforms.package_alias, v1.manifest).artifact).toBe("artifacts/package");
  });
});

describe("area provenance documents", () => {
  it.each([true, false])("accepts a well-formed document (v1: %s)", (v1) => {
    expect(() => assertAreaProvenanceDocument(snapshot({ v1 }).document)).not.toThrow();
  });

  it.each([
    ["no run record", (document) => { delete document.runs; }],
    ["a run for another table", (document) => { document.runs = { "constituency.csv": document.runs["regional.csv"] }; }],
    ["a short commit", (document) => { document.runs["regional.csv"].git_sha = "0123456"; }],
    ["unsorted years", (document) => { document.runs["regional.csv"].years = [2027, 2026]; }],
    ["no dataset name", (document) => { document.runs["regional.csv"].dataset.name = ""; }],
    ["no definition", (document) => { delete document.reforms.package_alias.definition; }],
    ["a definition for current law", (document) => { document.reforms.package_alias.definition.baseline = "f".repeat(64); }],
    ["a content definition other than its digest", (document) => { document.reforms.package_alias.definition.reform = "0".repeat(64); }],
    ["a v2 field in v1", (document) => { document.schema = AREA_PROVENANCE_SCHEMA_V1; }],
    ["an unknown schema", (document) => { document.schema = "uk-budget-area-provenance/v3"; }],
  ])("refuses %s", (_, change) => {
    const { document } = snapshot();
    change(document);
    expect(() => assertAreaProvenanceDocument(document)).toThrow(/Invalid area provenance/);
  });
});

describe("approved area calculation provenance", () => {
  it.each([true, false])("accepts the exact approved artifact, receipt and aliases (v1: %s)", (v1) => expect(() => check(snapshot({ v1 }))).not.toThrow());
  it.each([true, false])("refuses relabelling a package as a member even if the manifest aliases change (v1: %s)", (v1) => {
    const data = snapshot({ v1 });
    data.aliases.package_alias = "alpha";
    data.manifest.flat_aliases = data.aliases;
    expect(() => check(data)).toThrow(/aliases/);
  });
  it("v1: never accepts changed artifact or receipt identity with unchanged output bytes", () => {
    fc.assert(fc.property(fc.constantFrom("artifact_sha256", "receipt_sha256", "artifact"), fc.string(), (field, value) => {
      const data = snapshot({ v1: true });
      fc.pre(value !== data.manifest.combined.package[field]);
      data.manifest.combined.package[field] = value;
      expect(() => check(data)).toThrow(/approved calculation/);
    }));
  });
  it("v2: a national rerun's new artifact, receipt and outputs keep the binding", () => {
    const data = snapshot();
    for (const field of ["artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"]) data.manifest.combined.package[field] = "0".repeat(64);
    data.manifest.combined.package.artifact = "artifacts/package-rerun";
    expect(() => check(data)).not.toThrow();
  });
  it.each([true, false])("never certifies a held or unpublished calculation (v1: %s)", (v1) => {
    fc.assert(fc.property(fc.constantFrom("staged", "stale", "withdrawn", "not_computable", "unpublished"), (status) => {
      const data = snapshot({ v1 });
      data.manifest.combined.package.status = status;
      expect(() => check(data)).toThrow();
    }));
  });
  it.each([true, false])("refuses tables the area run did not write (v1: %s)", (v1) => {
    const data = snapshot({ v1 });
    data.files = { "regional.csv": "0".repeat(64) };
    expect(() => check(data)).toThrow(/bound tables/);
  });
  it("requires aliases to equal the verified provenance for arbitrary alias targets", () => {
    fc.assert(fc.property(fc.string(), (key) => {
      const data = snapshot();
      fc.pre(key !== "package");
      data.aliases.package_alias = key;
      expect(() => check(data)).toThrow();
    }));
  });
});

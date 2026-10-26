import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { assertAreaProvenance, assertAreaReceipt, AREA_PROVENANCE_SCHEMA } from "./area";

function snapshot() {
  const entry = { status: "approved", artifact: "artifacts/package", artifact_sha256: "a".repeat(64), receipt_sha256: "b".repeat(64), outputs_sha256: "c".repeat(64), execution_identity_sha256: "d".repeat(64) };
  const record = { ...entry, key: "package", execution_identity_sha256: "d".repeat(64), baseline: { kind: "current_law", representation: null, reform_sha256: null, binding: "content" }, reform: { kind: "reform", representation: "policyengine-uk.scenario/v1", reform_sha256: "f".repeat(64), binding: "content" } };
  delete record.status;
  const manifest = { measures: { alpha: { ...entry, artifact: "artifacts/alpha" } }, combined: { package: entry } };
  const files = { "regional.csv": "e".repeat(64) };
  return { manifest, files, document: { schema: AREA_PROVENANCE_SCHEMA, manifest_revision: 1, manifest_sha256: "a".repeat(64), files, reforms: { package_alias: record } }, aliases: { package_alias: "package" } };
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

describe("area receipt execution identities", () => {
  it("normalises missing optional receipt fields and ignores display names", () => {
    const record = snapshot().document.reforms.package_alias;
    expect(() => assertAreaReceipt(record, approvedReceipt(record))).not.toThrow();
  });

  it("refuses changed baseline or reform hashes with unchanged approved output bytes", () => {
    fc.assert(fc.property(
      fc.constantFrom("baseline", "reform"),
      fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 }).map((digits) => digits.map((digit) => digit.toString(16)).join("")),
      (side, digest) => {
        const record = snapshot().document.reforms.package_alias;
        record.baseline = { ...record.reform, reform_sha256: "e".repeat(64) };
        const receipt = approvedReceipt(record);
        receipt.execution_receipt.baseline = { ...record.baseline, name: "Approved baseline" };
        fc.pre(digest !== record[side].reform_sha256);
        record[side].reform_sha256 = digest;
        expect(record.outputs_sha256).toBe(receipt.dashboard.digests.outputs_sha256);
        expect(() => assertAreaReceipt(record, receipt)).toThrow(/identity differs/);
      },
    ));
  });

  it.each(["key", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"])("refuses a changed receipt %s", (field) => {
    const record = snapshot().document.reforms.package_alias;
    const receipt = approvedReceipt(record);
    if (field === "key") receipt.dashboard.key = "another-entry";
    else receipt.dashboard.digests[field] = "0".repeat(64);
    expect(() => assertAreaReceipt(record, receipt)).toThrow(/approved receipt/);
  });

  it.each(["kind", "representation", "binding"])("refuses a changed reform %s", (field) => {
    const record = snapshot().document.reforms.package_alias;
    const receipt = approvedReceipt(record);
    receipt.execution_receipt.reform[field] = "another-value";
    expect(() => assertAreaReceipt(record, receipt)).toThrow(/reform identity differs/);
  });
});

describe("approved area calculation provenance", () => {
  it("accepts the exact approved artifact, receipt and aliases", () => expect(() => check(snapshot())).not.toThrow());
  it("refuses relabelling a package as a member even if the manifest aliases change", () => {
    const data = snapshot();
    data.aliases.package_alias = "alpha";
    data.manifest.flat_aliases = data.aliases;
    expect(() => check(data)).toThrow(/aliases/);
  });
  it("never accepts changed artifact or receipt identity with unchanged output bytes", () => {
    fc.assert(fc.property(fc.constantFrom("artifact_sha256", "receipt_sha256", "artifact"), fc.string(), (field, value) => {
      const data = snapshot();
      fc.pre(value !== data.manifest.combined.package[field]);
      data.manifest.combined.package[field] = value;
      expect(() => check(data)).toThrow(/approved calculation/);
    }));
  });
  it("never certifies a held or unpublished calculation", () => {
    fc.assert(fc.property(fc.constantFrom("staged", "stale", "withdrawn", "not_computable", "unpublished"), (status) => {
      const data = snapshot();
      data.manifest.combined.package.status = status;
      expect(() => check(data)).toThrow();
    }));
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

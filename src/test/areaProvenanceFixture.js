import { AREA_PROVENANCE_SCHEMA, AREA_PROVENANCE_SCHEMA_V1 } from "../utils/publication/area";

/**
 * Synthetic provenance for tests whose approved national tables are supplied separately.
 * Schema v2 by default (`{ v1: true }` for the record area runs wrote before it).
 */
export async function areaProvenanceFixture(manifest, files, aliases = {}, { v1 = false } = {}) {
  const { artifactSha256 } = await import("../utils/publication/digest");
  const records = Object.create(null);
  const receipts = Object.create(null);
  for (const [key, entry] of Object.entries({ ...manifest.measures, ...manifest.combined })) {
    if (!["approved", "provisional"].includes(entry.status)) continue;
    entry.artifact ??= `artifacts/${key}/synthetic`;
    for (const field of ["artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"]) entry[field] ??= "a".repeat(64);
    const id = Object.keys(aliases).find((alias) => aliases[alias] === key) ?? key;
    records[id] = Object.fromEntries(["artifact", "artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"].map((field) => [field, entry[field]]));
    Object.assign(records[id], { key,
      baseline: { kind: "current_law", representation: null, reform_sha256: null, binding: "content" },
      reform: { kind: "reform", representation: "policyengine-uk.scenario/v1", reform_sha256: "f".repeat(64), binding: "content" },
    });
    // Content-bound: the definition digest is the identity's own
    if (!v1) records[id].definition = { baseline: null, reform: "f".repeat(64) };
    const receipt = { schema: "uk-budget-dashboard/artifact-receipt/v1", execution_receipt: { baseline: records[id].baseline, reform: records[id].reform }, dashboard: { key, digests: Object.fromEntries(["receipt_sha256", "outputs_sha256", "execution_identity_sha256"].map((field) => [field, entry[field]])) } };
    records[id].artifact_sha256 = entry.artifact_sha256 = await artifactSha256(receipt);
    receipts[`${entry.artifact}/receipt.json`] = JSON.stringify(receipt);
  }
  const document = { schema: v1 ? AREA_PROVENANCE_SCHEMA_V1 : AREA_PROVENANCE_SCHEMA, manifest_revision: manifest.revision ?? 1, manifest_sha256: "a".repeat(64), files, reforms: records };
  if (!v1) {
    document.runs = Object.fromEntries(Object.keys(files).map((name) => [name, {
      git_sha: "a".repeat(40), years: [2027], dataset: { kind: "synthetic", name: "test.h5", sha256: null },
    }]));
  }
  return { receipts, document };
}

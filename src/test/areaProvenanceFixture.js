import { AREA_PROVENANCE_SCHEMA } from "../utils/publication/area";

/** Synthetic provenance for tests whose approved national tables are supplied separately. */
export async function areaProvenanceFixture(manifest, files, aliases = {}) {
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
    const receipt = { schema: "uk-budget-dashboard/artifact-receipt/v1", execution_receipt: { baseline: records[id].baseline, reform: records[id].reform }, dashboard: { key, digests: Object.fromEntries(["receipt_sha256", "outputs_sha256", "execution_identity_sha256"].map((field) => [field, entry[field]])) } };
    records[id].artifact_sha256 = entry.artifact_sha256 = await artifactSha256(receipt);
    receipts[`${entry.artifact}/receipt.json`] = JSON.stringify(receipt);
  }
  return { receipts, document: { schema: AREA_PROVENANCE_SCHEMA, manifest_revision: manifest.revision ?? 1, manifest_sha256: "a".repeat(64), files, reforms: records } };
}

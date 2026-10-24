/** Validate the manifest-bound record of the approved area calculations. */
export const AREA_PROVENANCE_FILE = "area_provenance.json";
export const AREA_PROVENANCE_SCHEMA = "uk-budget-area-provenance/v1";
const DIGEST = /^[0-9a-f]{64}$/;
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameMap = (left, right) => isMap(left) && isMap(right) &&
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && right[key] === value);

const isIdentity = (value) => isMap(value) &&
  Object.keys(value).sort().join() === "binding,kind,reform_sha256,representation" &&
  ["content", "code_revision"].includes(value.binding) &&
  (value.kind === "current_law" ? value.representation === null && value.reform_sha256 === null && value.binding === "content" :
    value.kind === "reform" && typeof value.representation === "string" && DIGEST.test(value.reform_sha256 ?? ""));

const hasKeys = (value, keys) => isMap(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const isDigest = (value) => typeof value === "string" && value.length === 64 && DIGEST.test(value);

/** Compare an area run's identities with the approved artifact's receipt. */
export function assertAreaReceipt(record, receipt) {
  const dashboard = receipt?.dashboard;
  const execution = receipt?.execution_receipt;
  const identityFields = ["kind", "representation", "reform_sha256", "binding"];
  if (!isMap(record) || typeof record.key !== "string" || !record.key ||
      !isMap(dashboard) || dashboard.key !== record.key || !isMap(dashboard.digests) ||
      ["receipt_sha256", "outputs_sha256", "execution_identity_sha256"].some(
        (field) => !isDigest(record[field]) || dashboard.digests[field] !== record[field],
      ) || !isMap(execution)) {
    throw new Error("Area provenance differs from the approved receipt");
  }
  for (const side of ["baseline", "reform"]) {
    const approved = execution[side];
    // Receipt names are presentation labels. Missing optional members are
    // null, as Python's identity_core normalises them in the area runner.
    const identity = isMap(approved)
      ? Object.fromEntries(identityFields.map((field) => [field, approved[field] ?? null]))
      : null;
    if (!isIdentity(record[side]) || !isIdentity(identity) || !sameMap(record[side], identity)) {
      throw new Error(`Area ${side} identity differs from the approved receipt`);
    }
  }
}

export function assertAreaProvenanceDocument(document) {
  if (!hasKeys(document, ["schema", "manifest_revision", "manifest_sha256", "files", "reforms"]) ||
      document.schema !== AREA_PROVENANCE_SCHEMA || !Number.isInteger(document.manifest_revision) || document.manifest_revision < 1 ||
      !isDigest(document.manifest_sha256) || !isMap(document.files) || !Object.keys(document.files).length ||
      Object.entries(document.files).some(([file, digest]) => !["constituency.csv", "regional.csv"].includes(file) || !isDigest(digest)) ||
      !isMap(document.reforms) || !Object.keys(document.reforms).length) throw new Error("Invalid area provenance document");
  for (const [id, record] of Object.entries(document.reforms)) {
    if (!id || !hasKeys(record, ["key", "artifact", "artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256", "baseline", "reform"]) ||
        typeof record.key !== "string" || !record.key || typeof record.artifact !== "string" || !record.artifact ||
        record.artifact.startsWith("/") || record.artifact.split("/").includes("..") ||
        ["artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"].some((field) => !isDigest(record[field])) ||
        !isIdentity(record.baseline) || !isIdentity(record.reform)) throw new Error("Invalid area provenance identity");
  }
}

export function assertAreaProvenance(document, manifest, files, aliases) {
  assertAreaProvenanceDocument(document);
  if (document?.schema !== AREA_PROVENANCE_SCHEMA || !sameMap(document.files, files) || !isMap(document.reforms) || !Object.keys(document.reforms).length) {
    throw new Error("Area provenance does not match the bound tables");
  }
  const expectedAliases = Object.create(null);
  for (const [id, record] of Object.entries(document.reforms)) {
    const key = record?.key;
    const entry = Object.hasOwn(manifest.measures ?? {}, key) ? manifest.measures[key] :
      Object.hasOwn(manifest.combined ?? {}, key) ? manifest.combined[key] : null;
    if (!entry || !["approved", "provisional"].includes(entry.status) ||
        ["artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"].some((field) => !DIGEST.test(record[field] ?? "") || entry[field] !== record[field]) ||
        record.artifact !== entry.artifact || !DIGEST.test(record.execution_identity_sha256 ?? "") ||
        !isIdentity(record.baseline) || !isIdentity(record.reform)) {
      throw new Error("Area provenance does not identify the approved calculation");
    }
    if (id !== key) expectedAliases[id] = key;
  }
  if (!sameMap(expectedAliases, aliases)) throw new Error("Area aliases differ from verified provenance");
}


/** Every area CSV row must belong to an approved calculation recorded by the area run. */
export function assertAreaRows(rows, provenance) {
  const [header, ...records] = rows;
  const columns = header?.map((name, index) => index === 0 ? name.replace(/^\uFEFF/, "") : name);
  const identityColumns = columns?.filter((name) => ["reform_id", "reform"].includes(name)) ?? [];
  if (identityColumns.length !== 1 || !isMap(provenance?.reforms)) {
    throw new Error("Area CSV has no unambiguous reform column or verified provenance");
  }
  const index = columns.indexOf(identityColumns[0]);
  for (const row of records) {
    // CSV readers ignore empty lines; an empty field in a populated row is invalid.
    if (row.length === 1 && row[0] === "") continue;
    if (row.length !== columns.length || !row[index] || !Object.hasOwn(provenance.reforms, row[index])) {
      throw new Error("Area CSV reform has no verified provenance");
    }
  }
}

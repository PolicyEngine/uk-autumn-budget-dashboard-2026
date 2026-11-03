/**
 * Validate the manifest-bound record of the approved area calculations.
 *
 * Two schemas. v1 (area runs before #<this PR>) binds the area tables to the
 * national artifact each reform's figures came from, so any national rerun
 * refuses them. v2 binds them to what their figures depend on: each reform's
 * definition, the local-area dataset and the area code (the last checked by
 * `publish index` only, from git). The page checks the part it can: the same
 * reforms, still displayable, and each definition still the current
 * approved receipt's. A code-bound definition's digest leaves out the
 * commit, which the receipt's includes, so for those the page checks the
 * kind, representation and binding, and relies on `publish index`, which
 * recomputed it from the code, for the digest. The index binds the exact
 * manifest bytes it checked.
 */
export const AREA_PROVENANCE_FILE = "area_provenance.json";
export const AREA_PROVENANCE_SCHEMA_V1 = "uk-budget-area-provenance/v1";
export const AREA_PROVENANCE_SCHEMA = "uk-budget-area-provenance/v2";
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const AREA_FILES = ["constituency.csv", "regional.csv"];
const RECORD_DIGESTS = ["artifact_sha256", "receipt_sha256", "outputs_sha256", "execution_identity_sha256"];
const IDENTITY_FIELDS = ["kind", "representation", "reform_sha256", "binding"];
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
const isV2 = (document) => document?.schema === AREA_PROVENANCE_SCHEMA;

/** A receipt side's identity, its optional members null, as Python's identity_core. */
const identityCore = (approved) => isMap(approved)
  ? Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, approved[field] ?? null]))
  : null;

const manifestEntry = (manifest, key) => Object.hasOwn(manifest.measures ?? {}, key) ? manifest.measures[key] :
  Object.hasOwn(manifest.combined ?? {}, key) ? manifest.combined[key] : null;

/** A v2 definition: each side's commit-free digest, null for current law. */
function isDefinition(definition, record) {
  if (!hasKeys(definition, ["baseline", "reform"])) return false;
  return ["baseline", "reform"].every((side) => record[side]?.kind === "current_law"
    ? definition[side] === null
    : isDigest(definition[side]) &&
      (record[side]?.binding !== "content" || definition[side] === record[side].reform_sha256));
}

function isRun(run) {
  return hasKeys(run, ["git_sha", "years", "dataset"]) && typeof run.git_sha === "string" && COMMIT.test(run.git_sha) &&
    Array.isArray(run.years) && run.years.length > 0 && run.years.every((year, index) => Number.isInteger(year) && (index === 0 || year > run.years[index - 1])) &&
    hasKeys(run.dataset, ["kind", "name", "sha256"]) && typeof run.dataset.kind === "string" && !!run.dataset.kind &&
    typeof run.dataset.name === "string" && !!run.dataset.name && (run.dataset.sha256 === null || isDigest(run.dataset.sha256));
}

/**
 * The receipt an area record is checked against, and the artifact digest
 * it must have: v1, the artifact the area run read; v2, the manifest's
 * current entry for the record's key.
 */
export function areaReceiptTarget(document, record, manifest) {
  if (!isV2(document)) return { artifact: record.artifact, artifactSha256: record.artifact_sha256 };
  const entry = manifestEntry(manifest, record.key);
  if (!entry || typeof entry.artifact !== "string" || !isDigest(entry.artifact_sha256)) {
    throw new Error("Area provenance does not identify the approved calculation");
  }
  return { artifact: entry.artifact, artifactSha256: entry.artifact_sha256 };
}

/**
 * Compare an area run's identities with the approved artifact's receipt.
 * v1: the very receipt the area run read. v2: the current approved
 * receipt, for the same definition.
 */
export function assertAreaReceipt(record, receipt, schema = AREA_PROVENANCE_SCHEMA_V1) {
  const dashboard = receipt?.dashboard;
  const execution = receipt?.execution_receipt;
  const v2 = schema === AREA_PROVENANCE_SCHEMA;
  if (!isMap(record) || typeof record.key !== "string" || !record.key ||
      !isMap(dashboard) || dashboard.key !== record.key || !isMap(dashboard.digests) || !isMap(execution) ||
      (!v2 && ["receipt_sha256", "outputs_sha256", "execution_identity_sha256"].some(
        (field) => !isDigest(record[field]) || dashboard.digests[field] !== record[field],
      ))) {
    throw new Error("Area provenance differs from the approved receipt");
  }
  for (const side of ["baseline", "reform"]) {
    // Receipt names are presentation labels.
    const identity = identityCore(execution[side]);
    if (!isIdentity(record[side]) || !isIdentity(identity)) {
      throw new Error(`Area ${side} identity differs from the approved receipt`);
    }
    const same = v2
      // The same definition: a content digest is commit-free, so it must be
      // equal; a code-bound one includes the receipt's commit.
      ? ["kind", "representation", "binding"].every((field) => record[side][field] === identity[field]) &&
        (identity.binding !== "content" || record[side].reform_sha256 === identity.reform_sha256)
      : sameMap(record[side], identity);
    if (!same) throw new Error(`Area ${side} identity differs from the approved receipt`);
  }
}

export function assertAreaProvenanceDocument(document) {
  const v2 = isV2(document);
  const fields = ["schema", "manifest_revision", "manifest_sha256", "files", "reforms", ...(v2 ? ["runs"] : [])];
  if (!hasKeys(document, fields) ||
      ![AREA_PROVENANCE_SCHEMA_V1, AREA_PROVENANCE_SCHEMA].includes(document.schema) ||
      !Number.isInteger(document.manifest_revision) || document.manifest_revision < 1 ||
      !isDigest(document.manifest_sha256) || !isMap(document.files) || !Object.keys(document.files).length ||
      Object.entries(document.files).some(([file, digest]) => !AREA_FILES.includes(file) || !isDigest(digest)) ||
      !isMap(document.reforms) || !Object.keys(document.reforms).length ||
      (v2 && (!isMap(document.runs) || Object.keys(document.runs).sort().join() !== Object.keys(document.files).sort().join() ||
        !Object.values(document.runs).every(isRun)))) throw new Error("Invalid area provenance document");
  const recordFields = ["key", ...RECORD_DIGESTS, "artifact", "baseline", "reform", ...(v2 ? ["definition"] : [])];
  for (const [id, record] of Object.entries(document.reforms)) {
    if (!id || !hasKeys(record, recordFields) ||
        typeof record.key !== "string" || !record.key || typeof record.artifact !== "string" || !record.artifact ||
        record.artifact.startsWith("/") || record.artifact.split("/").includes("..") ||
        RECORD_DIGESTS.some((field) => !isDigest(record[field])) ||
        !isIdentity(record.baseline) || !isIdentity(record.reform) ||
        (v2 && !isDefinition(record.definition, record))) throw new Error("Invalid area provenance identity");
  }
}

export function assertAreaProvenance(document, manifest, files, aliases) {
  assertAreaProvenanceDocument(document);
  if (!sameMap(document.files, files)) {
    throw new Error("Area provenance does not match the bound tables");
  }
  const v2 = isV2(document);
  const expectedAliases = Object.create(null);
  for (const [id, record] of Object.entries(document.reforms)) {
    const key = record.key;
    const entry = manifestEntry(manifest, key);
    if (!entry || !["approved", "provisional"].includes(entry.status) ||
        // v1 only: the national artifact the area run read is still the entry's
        (!v2 && (RECORD_DIGESTS.some((field) => entry[field] !== record[field]) || record.artifact !== entry.artifact))) {
      throw new Error("Area provenance does not identify the approved calculation");
    }
    if (id !== key) expectedAliases[id] = key;
  }
  if (!sameMap(expectedAliases, aliases)) throw new Error("Area aliases differ from verified provenance");
}


/** Every area CSV row must belong to an approved calculation recorded by the area run. */
export function assertAreaRows(rows, provenance) {
  const [header, ...records] = rows;
  const columns = header?.map((name, index) => index === 0 ? name.replace(/^﻿/, "") : name);
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

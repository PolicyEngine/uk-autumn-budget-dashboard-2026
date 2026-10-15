/**
 * The publication manifest, as the browser reads it.
 *
 * `public/data/manifest.json` is the page's only entry point to published
 * figures. A number that is not in a displayable manifest entry is not shown.
 * The Python side (`uk_budget_data.publication`) writes and gates the
 * manifest; this module only reads it, and refuses one it does not understand.
 */

import contract from "./contract.json";

export const MANIFEST_SCHEMA = contract.manifest_schema;
export const MANIFEST_FILE = contract.manifest_file;
export const RECEIPT_FILE = contract.receipt_file;
export const STATUSES = contract.statuses;
export const DISPLAYABLE = contract.displayable;

export const PROVISIONAL_LABEL =
  "Provisional: statement figures, awaiting Treasury costing";

const DIGEST = /^[0-9a-f]{64}$/;

/** Raised when a manifest cannot be trusted. Lists every problem found. */
export class ManifestError extends Error {
  constructor(problems) {
    super(`The publication manifest is invalid: ${problems.join("; ")}`);
    this.name = "ManifestError";
    this.problems = problems;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isYearList(value) {
  return Array.isArray(value) && value.every(Number.isInteger);
}

/** True for a relative path that stays inside the data directory. */
export function isSafeArtifactPath(path) {
  if (typeof path !== "string" || path === "") return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes(":")) {
    return false;
  }
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function entryProblems(key, entry, { combined }) {
  const where = `${combined ? "combined" : "measures"}.${key}`;
  if (!isPlainObject(entry)) return [`${where} is not an object`];
  const problems = [];
  if (typeof entry.name !== "string" || entry.name === "") {
    problems.push(`${where}.name is missing`);
  }
  if (!STATUSES.includes(entry.status)) {
    problems.push(`${where}.status is ${JSON.stringify(entry.status)}`);
  }
  if (!isSafeArtifactPath(entry.artifact)) {
    problems.push(
      `${where}.artifact must be a relative path inside the data directory`,
    );
  }
  for (const field of [
    "outputs_sha256",
    "receipt_sha256",
    "execution_identity_sha256",
    "artifact_sha256",
  ]) {
    if (typeof entry[field] !== "string" || !DIGEST.test(entry[field])) {
      problems.push(`${where}.${field} is not a SHA-256 digest`);
    }
  }
  if (!isYearList(entry.years)) {
    problems.push(`${where}.years is not a list of years`);
  }
  if (
    entry.unsupported_years !== undefined &&
    !isYearList(entry.unsupported_years)
  ) {
    problems.push(`${where}.unsupported_years is not a list of years`);
  }
  if (combined) {
    const members = entry.measures;
    if (
      !Array.isArray(members) ||
      members.length === 0 ||
      !members.every((id) => typeof id === "string" && id !== "")
    ) {
      problems.push(`${where}.measures is not a list of measure ids`);
    }
    const memberOutputs = entry.member_outputs_sha256;
    if (
      !isPlainObject(memberOutputs) ||
      !Object.values(memberOutputs).every(
        (digest) => typeof digest === "string" && DIGEST.test(digest),
      )
    ) {
      problems.push(`${where}.member_outputs_sha256 is not a map of digests`);
    }
  }
  return problems;
}

/**
 * Validate a parsed manifest and return it.
 *
 * Unknown extra keys are allowed, so the Python side can add fields. Unknown
 * statuses are not: the page must never guess whether an entry may be shown.
 *
 * @throws {ManifestError} listing every problem.
 */
export function parseManifest(json) {
  if (!isPlainObject(json)) {
    throw new ManifestError(["it is not a JSON object"]);
  }
  const problems = [];
  if (json.schema !== MANIFEST_SCHEMA) {
    problems.push(`schema is ${JSON.stringify(json.schema)}`);
  }
  if (!Number.isInteger(json.revision) || json.revision < 1) {
    problems.push("revision is not a positive integer");
  }
  const groups = {
    measures: json.measures ?? {},
    combined: json.combined ?? {},
  };
  for (const [group, entries] of Object.entries(groups)) {
    if (!isPlainObject(entries)) {
      problems.push(`${group} is not an object`);
      continue;
    }
    for (const [key, entry] of Object.entries(entries)) {
      problems.push(
        ...entryProblems(key, entry, { combined: group === "combined" }),
      );
    }
  }
  const execution = json.execution;
  if (execution !== undefined && execution !== null) {
    if (
      !isPlainObject(execution) ||
      typeof execution.execution_identity_sha256 !== "string" ||
      !DIGEST.test(execution.execution_identity_sha256)
    ) {
      problems.push("execution.execution_identity_sha256 is not a digest");
    }
  }
  if (isPlainObject(groups.measures) && isPlainObject(groups.combined)) {
    for (const key of Object.keys(groups.measures)) {
      if (Object.hasOwn(groups.combined, key)) {
        problems.push(`${key} is both a measure and a combined run`);
      }
    }
  }
  if (problems.length === 0) {
    // Every displayable entry must share the manifest's execution identity.
    // The publish checks enforce this; the page refuses a manifest that
    // somehow breaks it rather than mix model or data versions.
    const shared = execution?.execution_identity_sha256;
    for (const [group, entries] of Object.entries(groups)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (!DISPLAYABLE.includes(entry.status)) continue;
        if (entry.execution_identity_sha256 !== shared) {
          problems.push(
            `${group}.${key} is displayable on a different execution ` +
              "identity from the manifest",
          );
        }
      }
    }
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return {
    ...json,
    measures: groups.measures,
    combined: groups.combined,
  };
}

/** True when the page may show this entry (approved or provisional). */
export function isDisplayable(entry) {
  return Boolean(entry) && DISPLAYABLE.includes(entry.status);
}

/** The entry for a measure id or a combined key, or undefined. */
export function entryFor(manifest, key) {
  if (Object.hasOwn(manifest.measures, key)) return manifest.measures[key];
  if (Object.hasOwn(manifest.combined, key)) return manifest.combined[key];
  return undefined;
}

function withReason(prefix, reason) {
  return reason ? `${prefix}: ${reason}` : prefix;
}

/**
 * Whether a measure (or a combined run) may be shown, and if not, why.
 *
 * @returns {{available: boolean, status: string|null, reason: string}}
 */
export function measureAvailability(manifest, key) {
  const entry = entryFor(manifest, key);
  if (!entry) {
    return { available: false, status: null, reason: "Not yet published" };
  }
  if (isDisplayable(entry)) {
    return { available: true, status: entry.status, reason: "" };
  }
  const reasons = {
    staged: "Awaiting approval",
    stale: withReason("Stale", entry.reason),
    withdrawn: withReason("Withdrawn", entry.reason),
  };
  return {
    available: false,
    status: entry.status,
    reason: reasons[entry.status] ?? "Not yet published",
  };
}

/** The label a displayed entry must carry: empty for approved figures. */
export function publicationLabel(entry) {
  return entry?.status === "provisional" ? PROVISIONAL_LABEL : "";
}

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
export const NOT_COMPUTABLE = "not_computable";

export const PROVISIONAL_LABEL =
  "Provisional: statement figures, awaiting Treasury costing";

const DIGEST = /^[0-9a-f]{64}$/;

function isDigest(value) {
  return typeof value === "string" && value.length === 64 && DIGEST.test(value);
}

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

/** Optional reviewed compatibility contract. Legacy key-only metadata may be
 * read, but personal selection requires a model, approval, explanation and years.
 */
export function personalSeriesProblems(value) {
  if (value === undefined || value === null) return [];
  if (!isPlainObject(value)) return ["personal mapping is not an object"];
  const problems = [];
  if (Object.keys(value).some((key) => !["key", "policies", "model", "reviewed", "description", "years", "unsupported_years"].includes(key))) {
    problems.push("personal mapping has unknown fields");
  }
  if (typeof value.key !== "string" || value.key.length === 0) {
    problems.push("personal mapping key is missing");
  }
  if (value.policies != null && (
    !Array.isArray(value.policies) || value.policies.length === 0 ||
    value.policies.some((id) => typeof id !== "string" || id.length === 0)
  )) {
    problems.push("personal mapping policies is not a non-empty list of ids");
  }
  if (value.policies != null && Array.isArray(value.policies) && new Set(value.policies).size !== value.policies.length) {
    problems.push("personal mapping policies contains duplicate ids");
  }
  if (value.model != null && !["lifecycle", "personal"].includes(value.model)) {
    problems.push("personal mapping model is unknown");
  }
  if (value.model != null && (typeof value.key !== "string" || !/^impact_[A-Za-z0-9][A-Za-z0-9_]*$/.test(value.key))) {
    problems.push("personal mapping key is not an impact series");
  }
  if (value.reviewed != null && typeof value.reviewed !== "boolean") {
    problems.push("personal mapping reviewed is not a boolean");
  }
  if (value.description != null && (typeof value.description !== "string" || value.description.trim().length === 0)) {
    problems.push("personal mapping description is empty");
  }
  for (const field of ["years", "unsupported_years"]) {
    if (value[field] != null && (!isYearList(value[field]) || new Set(value[field]).size !== value[field].length || (field === "years" && value[field].length === 0))) {
      problems.push(`personal mapping ${field} is not a unique list of years`);
    }
  }
  if (Array.isArray(value.years) && Array.isArray(value.unsupported_years) && value.years.some((year) => value.unsupported_years.includes(year))) {
    problems.push("personal mapping supported and unsupported years overlap");
  }
  return problems;
}

const DISPLAY_TEXT = ["short_description", "summary", "starts", "type", "details", "modelling"];
const DISPLAY_FIELDS = [...DISPLAY_TEXT, "color", "order", "source", "modelled_from"];

/**
 * How the page shows a measure (`display`, reforms.PUBLIC_DISPLAY), as
 * MeasureDisplay in uk_budget_data.publication.manifest checks it: every
 * field optional, none unknown.
 */
export function displayProblems(value) {
  if (value === undefined || value === null) return [];
  if (!isPlainObject(value)) return ["display is not an object"];
  const problems = [];
  if (Object.keys(value).some((key) => !DISPLAY_FIELDS.includes(key))) problems.push("display has unknown fields");
  if (value.color != null && (typeof value.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.color))) problems.push("display color is not a hex colour");
  if (value.order != null && (!Number.isInteger(value.order) || value.order < 0)) problems.push("display order is not a non-negative integer");
  if (value.modelled_from != null && !Number.isInteger(value.modelled_from)) problems.push("display modelled_from is not a year");
  for (const field of DISPLAY_TEXT) {
    if (value[field] != null && (typeof value[field] !== "string" || value[field].length === 0)) problems.push(`display ${field} is not text`);
  }
  if (value.source != null && (
    !isPlainObject(value.source) || Object.keys(value.source).some((key) => !["label", "href"].includes(key)) ||
    typeof value.source.label !== "string" || value.source.label.length === 0 ||
    typeof value.source.href !== "string" || !value.source.href.startsWith("https://")
  )) problems.push("display source is not a label and https link");
  return problems;
}

/** Python's whitespace and Unicode case-fold rules for attestor names. */
function stripped(value) {
  const whitespace = new Set(contract.name_whitespace);
  const characters = Array.from(value);
  let start = 0;
  let end = characters.length;
  while (start < end && whitespace.has(characters[start])) start += 1;
  while (end > start && whitespace.has(characters[end - 1])) end -= 1;
  return characters.slice(start, end).join("");
}

function foldedName(value) {
  return Array.from(
    stripped(value),
    (char) => contract.name_casefold[char] ?? char,
  ).join("");
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || match[0] !== value) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  const second = Number(match[6] ?? "0");
  const instant = new Date(value);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour < 24 &&
    minute < 60 &&
    second < 60 &&
    Number.isFinite(instant.getTime()) &&
    instant.getUTCFullYear() >= 1 &&
    instant.getUTCFullYear() <= 9999
  );
}

/** Structural attestation checks shared by manifest and receipt checks. */
export function attestationProblems(attestation, key) {
  if (!isPlainObject(attestation)) return ["attestation is not an object"];
  const problems = [];
  const fields = [
    "measure_id",
    "receipt_sha256",
    "reason",
    "checker",
    "second",
    "released_at",
  ];
  if (Object.keys(attestation).some((field) => !fields.includes(field))) {
    problems.push("attestation has unknown fields");
  }
  if (attestation.measure_id !== key) {
    problems.push("attestation names a different measure");
  }
  if (!isDigest(attestation.receipt_sha256)) {
    problems.push("attestation receipt_sha256 is not a SHA-256 digest");
  }
  for (const field of ["reason", "checker", "second"]) {
    if (
      typeof attestation[field] !== "string" ||
      stripped(attestation[field]) === ""
    ) {
      problems.push(`attestation ${field} is empty`);
    }
  }
  if (
    typeof attestation.checker === "string" &&
    typeof attestation.second === "string" &&
    foldedName(attestation.checker) === foldedName(attestation.second)
  ) {
    problems.push("attestation checker and second must be distinct");
  }
  // An audit timestamp includes its timezone, so the release has one
  // unambiguous instant. Date-only strings and locale formats are refused.
  if (!isIsoTimestamp(attestation.released_at)) {
    problems.push("attestation released_at is not an ISO 8601 timestamp");
  }
  return problems;
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
  if (entry.description !== undefined && typeof entry.description !== "string") {
    problems.push(`${where}.description is not text`);
  }
  problems.push(...personalSeriesProblems(entry.personal).map((problem) => `${where}.${problem}`));
  problems.push(...displayProblems(entry.display).map((problem) => `${where}.${problem}`));
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
    if (!isDigest(entry[field])) {
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
  // A measure the certified data cannot cost names its data limits and is
  // listed only as not computable, with its reason: never with a figure.
  const limits = entry.data_limits;
  if (
    limits !== undefined &&
    !(
      Array.isArray(limits) &&
      limits.every((limit) => typeof limit === "string" && limit !== "")
    )
  ) {
    problems.push(`${where}.data_limits is not a list of limit keys`);
  }
  const limited = Array.isArray(limits) && limits.length > 0;
  if (
    entry.status === NOT_COMPUTABLE &&
    !(limited && typeof entry.reason === "string" && entry.reason !== "")
  ) {
    problems.push(
      `${where} is not computable but names no data limit or reason`,
    );
  }
  if (limited && DISPLAYABLE.includes(entry.status)) {
    problems.push(`${where} has data limits, so its figures cannot be shown`);
  }
  if (entry.attestation !== undefined && entry.attestation !== null) {
    problems.push(
      ...attestationProblems(entry.attestation, key).map(
        (problem) => `${where}.${problem}`,
      ),
    );
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
      !Object.values(memberOutputs).every(isDigest)
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
      !isDigest(execution.execution_identity_sha256)
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
    [NOT_COMPUTABLE]: withReason(
      "Not computable on current data",
      entry.reason,
    ),
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

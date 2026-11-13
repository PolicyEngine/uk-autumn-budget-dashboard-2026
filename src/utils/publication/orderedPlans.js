/** Portable ordered plans are data. No carried module or name is resolved. */
import canonicalize from "canonicalize";
export const ORDERED_REPRESENTATION = "policyengine-uk.phased_scenario_composition/v1";
export const ORDERED_APPLICATION = "before_data_load_then_after_data_load";
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = /^[0-9a-f]{64}$/;
const fullMatch = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
// Match the upstream Pydantic/Rust Unicode word class after the ASCII head.
const identifier = "[A-Za-z_][\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\u200c\\u200d]*";
const moduleName = new RegExp(`^${identifier}(?:\\.${identifier})*$`, "u");
const functionName = new RegExp(`^${identifier}$`, "u");
const fail = message => {
  throw new Error(message);
};
export function closed(value, fields) {
  if (!isObject(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail("Unexpected or missing fields");
}
function unicode(value) {
  // RFC8785 rejects unpaired UTF-16 surrogates rather than replacing them.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail("Invalid Unicode");
}
export function strictJson(value) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    unicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) fail("Invalid JSON numeric domain");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) strictJson(item);
    return;
  }
  if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Not JSON data");
  for (const [key, item] of Object.entries(value)) {
    unicode(key);
    strictJson(item);
  }
}

/** Dashboard content digests omit null object members, retaining array nulls. */
export async function contentSha256(value) {
  const clean = item => Array.isArray(item) ? item.map(clean) : isObject(item) ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null).map(([k, v]) => [k, clean(v)])) : item;
  strictJson(value);
  return canonicalSha256(clean(value));
}

/** Official identity digests retain nulls, unlike dashboard artifact digests. */
export async function canonicalSha256(value) {
  strictJson(value);
  const bytes = new TextEncoder().encode(canonicalize(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function floatHex(value) {
  if (typeof value !== "string") return false;
  if (["inf", "-inf", "0x0.0p+0", "-0x0.0p+0"].includes(value)) return true;
  const match = /^-?0x([01])\.([0-9a-f]{13})p([+-](?:0|[1-9][0-9]*))$/.exec(value);
  if (!match || match[0] !== value || match[3] === "-0") return false;
  const exponent = Number(match[3]);
  return match[1] === "1" ? exponent >= -1022 && exponent <= 1023 : exponent === -1022 && /[1-9a-f]/.test(match[2]);
}
function typedDefault(value) {
  if (!isObject(value)) fail("Invalid typed default");
  const kind = value.type;
  if (kind === "none") {
    closed(value, ["type"]);
    return;
  }
  if (["bool", "int", "str"].includes(kind)) {
    closed(value, ["type", "value"]);
    if (kind === "bool" ? typeof value.value !== "boolean" : kind === "str" ? typeof value.value !== "string" : !Number.isSafeInteger(value.value)) fail("Invalid typed scalar");
    return;
  }
  if (kind === "float") {
    closed(value, ["type", "hex"]);
    if (!floatHex(value.hex)) fail("Noncanonical float default");
    return;
  }
  if (!["list", "tuple", "dict"].includes(kind)) fail("Unknown typed default");
  closed(value, ["type", "items"]);
  if (!Array.isArray(value.items)) fail("Invalid typed items");
  const keys = new Set();
  for (const item of value.items) {
    if (kind !== "dict") typedDefault(item);else {
      if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || keys.has(item[0])) fail("Invalid typed dictionary");
      keys.add(item[0]);
      typedDefault(item[1]);
    }
  }
}
const scalar = value => typeof value === "boolean" || typeof value === "number" || isObject(value) && Object.keys(value).length === 1 && ["Infinity", "-Infinity"].includes(value.$nonfinite);
export function validateParameters(changes) {
  if (!isObject(changes)) fail("Parameters must be an object");
  strictJson(changes);
  for (const [path, value] of Object.entries(changes)) {
    if (!path || path === "$nonfinite") fail("Invalid parameter path");
    if (scalar(value)) continue;
    if (!isObject(value) || Object.entries(value).some(([period, item]) => !period || period === "$nonfinite" || !scalar(item))) fail("Invalid native parameter value");
  }
}
function leaf(value) {
  closed(value, ["module", "qualname", "source_sha256", "module_source_sha256", "module_defaults", "code_revision"]);
  if (!fullMatch(moduleName, value.module) || !fullMatch(functionName, value.qualname) || !fullMatch(digest, value.source_sha256) || !fullMatch(digest, value.module_source_sha256)) fail("Invalid modifier provenance");
  closed(value.code_revision, ["repository", "git_sha"]);
  if (typeof value.code_revision.repository !== "string" || !value.code_revision.repository || !fullMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, value.code_revision.git_sha)) fail("Invalid code revision");
  if (value.module_defaults !== null) {
    if (!isObject(value.module_defaults) || !Object.keys(value.module_defaults).length) fail("Empty or invalid module defaults");
    for (const [name, item] of Object.entries(value.module_defaults)) {
      if (!name) fail("Empty default name");
      typedDefault(item);
    }
  }
}
export function validateOrderedPlan(plan) {
  strictJson(plan);
  closed(plan, ["application", "adapter_source_sha256", "before", "after"]);
  if (plan.application !== ORDERED_APPLICATION || !fullMatch(digest, plan.adapter_source_sha256)) fail("Unknown ordered adapter/application");
  for (const phase of ["before", "after"]) {
    closed(plan[phase], ["parameter_changes", "modifier_leaves"]);
    validateParameters(plan[phase].parameter_changes);
    if (!Array.isArray(plan[phase].modifier_leaves)) fail("Modifier leaves must be ordered");
    plan[phase].modifier_leaves.forEach(leaf);
  }
  if (Object.keys(plan.after.parameter_changes).length) fail("Parameters must apply before loading, once");
  return plan;
}
export function planLeafCount(plan) {
  validateOrderedPlan(plan);
  return plan.before.modifier_leaves.length + plan.after.modifier_leaves.length;
}
export async function parameterIdentity(changes) {
  validateParameters(changes);
  if (!Object.keys(changes).length) return {
    kind: "current_law",
    representation: null,
    reform_sha256: null,
    binding: "content"
  };
  return {
    kind: "reform",
    representation: "policyengine-uk.scenario/v1",
    binding: "content",
    reform_sha256: await canonicalSha256({
      representation: "policyengine-uk.scenario/v1",
      payload: {
        applied_before_data_load: true,
        parameter_changes: changes,
        simulation_modifier: null
      }
    })
  };
}
export async function orderedPlanIdentity(plan) {
  validateOrderedPlan(plan);
  if (!planLeafCount(plan)) return parameterIdentity(plan.before.parameter_changes);
  return {
    kind: "reform",
    representation: ORDERED_REPRESENTATION,
    binding: "code_revision",
    reform_sha256: await canonicalSha256({
      representation: ORDERED_REPRESENTATION,
      payload: plan
    })
  };
}

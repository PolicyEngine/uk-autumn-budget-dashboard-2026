/** Reconstruct publication identities from inert data; never resolve locators. */
import canonicalize from "canonicalize";
import contract from "./contract.json";
import executionSchema from "./schemas/execution_receipt.v1.schema.json";
import { closed, contentSha256, isObject, orderedPlanIdentity, ORDERED_REPRESENTATION, parameterIdentity, planLeafCount, strictJson, validateOrderedPlan, validateParameters } from "./orderedPlans";
export const ORDERED_METHOD = "resolved_common_policy_phases/v1";
export const ORDERED_SINGLE = "uk-budget-dashboard/policy-comparison/v2";
const PARAMETER_METHOD = "resolved_common_policy/v1";
const PARAMETER_SINGLE = "uk-budget-dashboard/policy-comparison/v1";
const COMMON_SCHEMA = "uk-budget-dashboard/common-policy-reference/v1";
const SHARED_PREFIXES = ["gov.simulation.capital_gains_responses."];
const REPRESENTATIONS = new Set(executionSchema.$defs.ReformIdentity.properties.representation.anyOf.find(shape => shape.enum).enum);
const MODEL = executionSchema.$defs.ModelIdentity;
// PEP440 syntax from packaging.version.VERSION_PATTERN. Runtime metadata must
// identify an actual version before any historical/native policy dispatch.
const MODEL_VERSION = /^v?(?:(?<epoch>[0-9]+)!)?(?<release>[0-9]+(?:\.[0-9]+)*)(?:[-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?[0-9]*)?(?:-[0-9]+|[-_.]?(?:post|rev|r)[-_.]?[0-9]*)?(?:[-_.]?dev[-_.]?[0-9]*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;
const fail = message => {
  throw new Error(message);
};
const same = (a, b) => canonicalize(a) === canonicalize(b);
const core = value => ({
  kind: value?.kind,
  representation: value?.representation ?? null,
  reform_sha256: value?.reform_sha256 ?? null,
  binding: value?.binding ?? "content"
});
function identity(value) {
  if (!isObject(value) || Object.keys(value).some(k => !["kind", "representation", "reform_sha256", "binding", "name"].includes(k))) fail("Malformed reform identity");
  strictJson(value);
  const c = core(value);
  if (!["content", "code_revision"].includes(c.binding) || value.name !== undefined && value.name !== null && typeof value.name !== "string") fail("Unknown identity binding/name");
  if (c.kind === "current_law") {
    if (c.representation !== null || c.reform_sha256 !== null || c.binding !== "content") fail("Malformed current-law identity");
  } else if (c.kind !== "reform" || !REPRESENTATIONS.has(c.representation) || typeof c.reform_sha256 !== "string" || c.reform_sha256.length !== 64 || !/^[0-9a-f]{64}$/.test(c.reform_sha256) || c.representation === ORDERED_REPRESENTATION && c.binding !== "code_revision") fail("Unknown reform representation or digest");
  return c;
}
const matches = (a, b) => same(identity(a), identity(b));
function actualModelIdentity(model) {
  if (!isObject(model)) fail("Missing actual model identity");
  strictJson(model);
  if (MODEL.required.some(field => !Object.hasOwn(model, field)) || Object.keys(model).some(field => !Object.hasOwn(MODEL.properties, field))) fail("Unknown or missing actual model fields");
  if (model.name !== MODEL.properties.name.const || typeof model.version !== "string" || !MODEL_VERSION.test(model.version.trim())) fail("Unknown model or unparseable actual model version");
  for (const field of ["install_origin", "wheel_sha256_evidence"]) {
    const allowed = MODEL.properties[field].anyOf.find(shape => shape.enum).enum;
    if (model[field] != null && !allowed.includes(model[field])) fail("Invalid actual model metadata");
  }
  if (model.wheel_sha256 != null && (typeof model.wheel_sha256 !== "string" || model.wheel_sha256.length !== 64 || !/^[0-9a-f]{64}$/.test(model.wheel_sha256))) fail("Invalid actual model wheel digest");
  return model;
}
function nativeModel(model, expected) {
  const parts = version => {
    if (typeof version !== "string") fail("Missing native model version floor");
    const match = MODEL_VERSION.exec(version.trim());
    if (!match) fail("Unparseable native model version floor");
    return [BigInt(match.groups.epoch ?? "0"), ...match.groups.release.split(".").map(BigInt)];
  };
  const actual = parts(model.version);
  const floor = parts(expected?.required_model_version_floor ?? "2.174.1");
  // Compare epoch/release tuples, not full PEP440 ordering. This dashboard
  // migration floor includes pre/dev/local builds in the same release cohort;
  // exact trusted policy-record matching below determines admissibility.
  let atFloor = true;
  for (let index = 0; index < Math.max(actual.length, floor.length); index++) {
    const a = actual[index] ?? 0n;
    const b = floor[index] ?? 0n;
    if (a !== b) { atFloor = a > b; break; }
  }
  return atFloor || ["2.174.1", ...(expected?.required_model_versions ?? [])].includes(model.version);
}
async function validateCommon(common, expected, model) {
  closed(common, ["schema", "parameter_changes", "identity", "policy_record", "policy_record_sha256"]);
  if (common.schema !== COMMON_SCHEMA || !expected?.common_policy_reference) fail("Missing trusted common-policy contract");
  validateParameters(common.parameter_changes);
  const current = expected.common_policy_reference;
  if (model.version !== current.policy_record?.native_model_version) fail("Actual model differs from the trusted native policy record");
  if (!same(common.policy_record, current.policy_record) || !same(common.parameter_changes, current.parameter_changes) || common.policy_record_sha256 !== current.policy_record_sha256) fail("Common policy differs from current source contract");
  if ((await contentSha256(common.policy_record)) !== common.policy_record_sha256 || !matches(common.identity, await parameterIdentity(common.parameter_changes)) || !matches(common.identity, current.identity)) fail("Common policy identity or record digest differs");
}
function mergeDeltas(changes, shared = SHARED_PREFIXES) {
  const merged = Object.create(null);
  for (const values of changes) {
    validateParameters(values);
    for (const [path, periods] of Object.entries(values)) {
      // Match combine._merge: raw member inputs carry period maps.
      if (!isObject(periods) || Object.hasOwn(periods, "$nonfinite")) fail("Member changes need period maps");
      if (Object.hasOwn(merged, path)) {
        if (shared.some(prefix => path.startsWith(prefix)) && same(merged[path], periods)) continue;
        fail(`Two member deltas change ${path}`);
      }
      merged[path] = structuredClone(periods);
    }
  }
  return merged;
}
function withCommon(common, changes) {
  const joined = Object.create(null);
  for (const [path, value] of Object.entries(common.parameter_changes)) joined[path] = structuredClone(value);
  for (const [path, value] of Object.entries(changes)) {
    joined[path] = isObject(joined[path]) && !Object.hasOwn(joined[path], "$nonfinite") && isObject(value) && !Object.hasOwn(value, "$nonfinite") ? {
      ...joined[path],
      ...value
    } : structuredClone(value);
  }
  return joined;
}

/** Common parameters once, then disjoint raw changes and ordered occurrences. */
export function resolveOrderedPlan(common, deltas, shared = SHARED_PREFIXES) {
  if (!Array.isArray(deltas) || !deltas.length) fail("Missing ordered deltas");
  deltas.forEach(validateOrderedPlan);
  const result = structuredClone(deltas[0]);
  if (deltas.some(p => p.adapter_source_sha256 !== result.adapter_source_sha256)) fail("Different execution adapters");
  result.before.parameter_changes = withCommon(common, mergeDeltas(deltas.map(p => p.before.parameter_changes), shared));
  for (const phase of ["before", "after"]) result[phase].modifier_leaves = deltas.flatMap(p => structuredClone(p[phase].modifier_leaves));
  validateOrderedPlan(result);
  return result;
}
function sharedBaseline(dashboard, members) {
  const configured = dashboard.config_baseline;
  const shareable = isObject(configured) && (configured.kind === "current_law" || configured.binding === "content");
  for (const member of members.filter(m => !m.baseline_bound)) {
    if (!shareable || !matches(member.baseline, configured) || !members.some(m => m.baseline_bound && matches(m.baseline, member.baseline))) fail("An unbound member baseline is not the shared configured baseline");
  }
}
function parameterDelta(delta) {
  closed(delta, ["parameter_changes", "applied_before_data_load"]);
  if (typeof delta.applied_before_data_load !== "boolean") fail("Missing delta timing");
  const changes = delta.parameter_changes ?? {};
  validateParameters(changes);
  return changes;
}
const containsOrderedIdentity = document => [document?.execution_receipt?.baseline, document?.execution_receipt?.reform, ...(document?.dashboard?.members ?? []).flatMap(m => [m.baseline, m.reform])].some(i => i?.representation === ORDERED_REPRESENTATION);

/** Counts occurrences in both effective phases, never aggregate wrappers. */
export function orderedModifierCounts(document) {
  const d = document?.dashboard ?? {};
  const recipe = d.composition ?? d.policy_comparison;
  if (recipe?.method !== ORDERED_METHOD && recipe?.schema !== ORDERED_SINGLE) {
    if (containsOrderedIdentity(document)) fail("An ordered identity lacks its execution plans");
    return null;
  }
  return Object.fromEntries(["baseline", "reform"].map(side => [side, planLeafCount(recipe[`${side}_plan`])]));
}

/** Validate common reference, member recipe and official plan identities offline. */
export async function comparisonProblems(document, expected = contract.native_policy_comparison) {
  try {
    const d = document?.dashboard ?? {};
    const execution = document?.execution_receipt ?? {};
    const model = actualModelIdentity(execution.model);
    identity(execution.baseline);
    identity(execution.reform);
    const members = d.members ?? [];
    if (!Array.isArray(members)) fail("Malformed comparison members");
    for (const m of members) {
      identity(m.baseline);
      identity(m.reform);
    }
    const combined = members.length > 0;
    const native = nativeModel(model, expected);
    if (combined && d.policy_comparison != null) fail("Combined runs cannot use a single comparison recipe");
    if (!combined && d.composition != null) fail("Composition metadata needs its combined members");
    const recipe = combined ? d.composition : d.policy_comparison;
    if (recipe == null) {
      if (native || containsOrderedIdentity(document)) fail("The native/ordered execution needs its comparison recipe");
      return [];
    }
    const method = combined ? recipe.method : recipe.schema;
    const ordered = method === (combined ? ORDERED_METHOD : ORDERED_SINGLE);
    const parameters = method === (combined ? PARAMETER_METHOD : PARAMETER_SINGLE);
    if (!ordered && !parameters) {
      // Historical single-phase composition metadata predates common policy.
      if (combined && !native && !containsOrderedIdentity(document) && recipe.method === undefined) {
        closed(recipe, ["baseline_applied_before_data_load", "reform_applied_before_data_load"]);
        if ([recipe.baseline_applied_before_data_load, recipe.reform_applied_before_data_load].some(v => typeof v !== "boolean")) fail("Malformed historical composition phases");
        return [];
      }
      fail("Unknown comparison schema or composition method");
    }
    closed(recipe, combined ? ordered ? ["method", "common_policy_reference", "baseline_plan", "reform_plan"] : ["method", "common_policy_reference", "baseline_applied_before_data_load", "reform_applied_before_data_load"] : ordered ? ["schema", "common_policy_reference", "baseline_delta", "reform_delta", "baseline_plan", "reform_plan"] : ["schema", "common_policy_reference", "baseline_delta", "reform_delta"]);
    if (containsOrderedIdentity(document) && !ordered) fail("Ordered execution cannot downgrade to parameter composition");
    const common = recipe.common_policy_reference;
    await validateCommon(common, expected, model);
    const shared = expected.shared_parameter_prefixes ?? SHARED_PREFIXES;
    if (combined) {
      const ids = members.map(m => m.id);
      if (ids.some(id => typeof id !== "string" || !id) || !same(ids, [...new Set(ids)].sort()) || !same(ids, [...(d.measure_ids ?? [])].sort())) fail("Member ids are not unique and canonical");
      for (const member of members) {
        closed(member, ["id", "baseline", "reform", "baseline_bound", "baseline_delta", "reform_delta"]);
        if (typeof member.baseline_bound !== "boolean") fail("Missing member baseline timing");
        for (const side of ["baseline", "reform"]) {
          const delta = member[`${side}_delta`];
          const rebuilt = ordered ? await orderedPlanIdentity(resolveOrderedPlan(common, [delta], shared)) : await parameterIdentity(withCommon(common, parameterDelta(delta)));
          if (!matches(member[side], rebuilt)) fail("Member identity does not bind its common reference and raw delta");
        }
      }
      sharedBaseline(d, members);
    }
    if (parameters && combined && (recipe.baseline_applied_before_data_load !== true || recipe.reform_applied_before_data_load !== true)) fail("Resolved parameters must apply before loading");
    for (const side of ["baseline", "reform"]) {
      const deltas = combined ? members.filter(m => side !== "baseline" || m.baseline_bound).map(m => m[`${side}_delta`]) : [recipe[`${side}_delta`]];
      const rebuilt = ordered ? resolveOrderedPlan(common, deltas, shared) : withCommon(common, mergeDeltas(deltas.map(parameterDelta), shared));
      if (ordered && !same(rebuilt, recipe[`${side}_plan`])) fail("Effective phase plan differs from common-once member composition");
      const effective = ordered ? await orderedPlanIdentity(rebuilt) : await parameterIdentity(rebuilt);
      if (!matches(execution[side], effective)) fail("Execution identity does not bind its resolved comparison");
    }
    return [];
  } catch (error) {
    return [`its policy comparison cannot be reconstructed: ${error.message}`];
  }
}

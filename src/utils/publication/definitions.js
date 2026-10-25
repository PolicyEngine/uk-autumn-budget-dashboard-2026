/**
 * Each measure's definition as its publication receipt binds it, and the
 * comparison with the one the household API reports.
 *
 * Personal impact asks the household API live. A receipt binds a measure's
 * baseline and reform by policyengine.py's reform identities, at the commit
 * it was made at; the API recomputes them at that commit from its own code
 * and reports them beside its answers (`?definition=<id>:<commit>`). The
 * page shows an answer only when every selected measure's matches its
 * receipt. This is the page's copy of `uk_budget_data.definitions`
 * (`receipt_definition` and `differences`); the contract's
 * `definition_vectors` hold the two to the same answers.
 */

import contract from "./contract.json";

/** The identity fields its digest depends on; `name` is a label. */
export const IDENTITY_FIELDS = contract.definition_identity_fields;

/** A full commit sha, the only kind a definition request takes. */
export const FULL_COMMIT = new RegExp(
  `^(?:${contract.definition_commit_pattern})$`,
);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A missing value is null, as Python's `.get` gives None
const valueOf = (object, name) =>
  Object.hasOwn(object, name) ? object[name] : null;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// A value JSON gives both languages alike. A number past 2^53, or one too
// large for a double (Infinity here), reads exactly in Python but not here,
// so two such numbers could match here and differ there.
const exact = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.every(exact);
  if (isObject(value)) return Object.values(value).every(exact);
  return true;
};

// The same JSON value. Stricter than Python's `==` where JSON can't tell
// them apart anyway (true and 1), and for numbers not read exactly here
// (`exact`), which are never the same: so it never passes what Python
// refuses.
const same = (a, b) => exact(a) && exact(b) && canonical(a) === canonical(b);

/** An identity's digest fields; anything but an object has none. */
export function identityCore(identity) {
  const given = isObject(identity) ? identity : {};
  return Object.fromEntries(
    IDENTITY_FIELDS.map((name) => [name, valueOf(given, name)]),
  );
}

/**
 * What a receipt approved: its commit and both identities' digest fields.
 *
 * @param {Object} receipt - A verified receipt document
 * @returns {{git_sha: string|null, baseline: Object, reform: Object}}
 */
export function receiptDefinition(receipt) {
  const document = isObject(receipt) ? receipt : {};
  const execution = isObject(document.execution_receipt)
    ? document.execution_receipt
    : {};
  const dashboard = isObject(document.dashboard) ? document.dashboard : {};
  return {
    git_sha: valueOf(dashboard, "git_sha"),
    baseline: identityCore(execution.baseline),
    reform: identityCore(execution.reform),
  };
}

const shown = (value, otherwise = "none") =>
  typeof value === "string" ? value : otherwise;

/**
 * How a reported definition differs from an approved one: empty when it is
 * the same definition. A missing report, or one the API could not bind
 * (`error`), is a difference.
 *
 * @param {Object} approved - From receiptDefinition
 * @param {*} reported - The API's `definitions[id]`
 * @returns {string[]}
 */
export function definitionDifferences(approved, reported) {
  if (!isObject(reported)) return ["no definition reported"];
  if (Object.hasOwn(reported, "error")) {
    return [
      `the running code cannot bind it: ${shown(reported.error, "no reason given")}`,
    ];
  }
  const ours = isObject(approved) ? approved : {};
  const problems = [];
  const theirCommit = valueOf(reported, "git_sha");
  const ourCommit = valueOf(ours, "git_sha");
  if (!same(theirCommit, ourCommit)) {
    problems.push(
      `reported at commit ${shown(theirCommit)}, not the approved ${shown(ourCommit)}`,
    );
  }
  for (const side of ["baseline", "reform"]) {
    const theirs = valueOf(reported, side);
    if (!isObject(theirs)) {
      problems.push(`no ${side} identity reported`);
      continue;
    }
    const approvedSide = identityCore(valueOf(ours, side));
    for (const name of IDENTITY_FIELDS) {
      if (!same(valueOf(theirs, name), approvedSide[name])) {
        problems.push(`its ${side} ${name} differs`);
      }
    }
  }
  return problems;
}

/**
 * The query a household request names its measures' approved commits in:
 * `definition=<id>:<commit>` once per measure, in id order.
 *
 * @param {Object<string, {git_sha: string}>} definitions
 * @returns {string} empty when none are named
 */
export function definitionQuery(definitions) {
  const params = new URLSearchParams();
  for (const id of Object.keys(definitions ?? {}).sort()) {
    params.append("definition", `${id}:${definitions[id].git_sha}`);
  }
  return params.toString();
}

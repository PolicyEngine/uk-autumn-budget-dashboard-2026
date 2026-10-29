/**
 * Digests that tie what the page shows to the manifest.
 *
 * A manifest entry names its artifact's `outputs_sha256`. That is the SHA-256
 * of the artifact's file-digest map, serialised as canonical JSON (RFC 8785)
 * with null object members dropped, which is the rule the Python side uses.
 * So the page can check an artifact in two steps:
 *
 * 1. the receipt's file-digest map hashes to the entry's `outputs_sha256`;
 * 2. each fetched file hashes to its value in that map.
 *
 * A file that fails either step is never shown.
 */

import canonicalize from "canonicalize";
import contract from "./contract.json";
import { attestationProblems, personalSeriesProblems } from "./manifest";

function toBytes(input) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  // By tag, not instanceof: a fetch Response from another realm (a test
  // runner's, a worker's) hands back an ArrayBuffer of that realm
  if (Object.prototype.toString.call(input) === "[object ArrayBuffer]") return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("sha256Hex needs a string or bytes");
}

/** SHA-256 of a string (as UTF-8) or of bytes, in lowercase hex. */
export async function sha256Hex(input) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toBytes(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Remove object members whose value is null, at every depth. */
export function dropNulls(value) {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, member]) => member !== null)
        .map(([key, member]) => [key, dropNulls(member)]),
    );
  }
  return value;
}

/** SHA-256 of a value's canonical JSON, with null members dropped. */
export async function jcsSha256(value) {
  return sha256Hex(canonicalize(dropNulls(value)));
}

function fileDigests(receipt) {
  const files = receipt?.dashboard?.files;
  return files !== null && typeof files === "object" && !Array.isArray(files)
    ? files
    : null;
}

/** Step 1: the receipt's file digests are the ones the manifest entry names. */
export async function verifyReceiptFiles(receipt, entry) {
  const files = fileDigests(receipt);
  if (!files || Object.keys(files).length === 0) return false;
  return (await jcsSha256(files)) === entry.outputs_sha256;
}

/** Step 2: a fetched file's content is the one the receipt lists. */
export async function verifyFile(name, content, receipt) {
  const files = fileDigests(receipt);
  if (!files || !Object.hasOwn(files, name)) return false;
  return (await sha256Hex(content)) === files[name];
}

/** Dashboard fields that describe one generation run (not digested). */
const VOLATILE_DASHBOARD_FIELDS = ["generated_at", "generator_argv"];

/**
 * The artifact digest the manifest names (Python's
 * ``receipt.artifact_sha256``): the receipt document without its
 * run-specific fields.
 */
export async function artifactSha256(receipt) {
  const dashboard = Object.fromEntries(
    Object.entries(receipt?.dashboard ?? {}).filter(
      ([name]) => !VOLATILE_DASHBOARD_FIELDS.includes(name),
    ),
  );
  return jcsSha256({
    schema: receipt?.schema,
    execution_receipt: receipt?.execution_receipt,
    dashboard,
  });
}

function sameList(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameSet(left, right) {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right ?? [])].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The receipt records one proof for each modifier bound on each side. */
export function modifierTemplatesProblems(receipt) {
  const proofs = receipt?.dashboard?.modifier_templates;
  if (
    proofs === null ||
    typeof proofs !== "object" ||
    Array.isArray(proofs) ||
    !sameSet(Object.keys(proofs), ["baseline", "reform"])
  ) {
    return ["the receipt does not record its modifier templates"];
  }
  const problems = [];
  for (const side of ["baseline", "reform"]) {
    if (!Array.isArray(proofs[side])) {
      problems.push(`the receipt's ${side} modifier templates are malformed`);
      continue;
    }
    const members = receipt?.dashboard?.members;
    const bound = (identity) => identity?.binding === "code_revision";
    const count =
      Array.isArray(members) && members.length > 0
        ? members.filter(
            (member) =>
              (side !== "baseline" || member?.baseline_bound === true) &&
              bound(member?.[side]),
          ).length
        : Number(bound(receipt?.execution_receipt?.[side]));
    if (proofs[side].length !== count) {
      problems.push(
        `the receipt's ${side} modifier templates do not match its bound modifiers`,
      );
    }
    for (const proof of proofs[side]) {
      if (proof === null) continue;
      if (
        !Array.isArray(proof) ||
        proof.length === 0 ||
        proof.some((id) => !contract.measure_templates.includes(id)) ||
        !sameList(proof, [...new Set(proof)].sort())
      ) {
        problems.push(`the receipt's ${side} modifier templates are malformed`);
        break;
      }
    }
  }
  if (
    ["baseline", "reform"].some(
      (side) => Array.isArray(proofs[side]) && proofs[side].includes(null),
    ) &&
    (typeof receipt?.dashboard?.generation_id !== "string" ||
      !/^[0-9a-f]{32}$/.test(receipt.dashboard.generation_id) ||
      receipt.dashboard.generation_id.length !== 32)
  ) {
    problems.push("the receipt's hand-written generation id is malformed");
  }
  return problems;
}

function isHeld(receipt) {
  return (
    contract.data_limits_active &&
    ["baseline", "reform"].some((side) =>
      receipt?.dashboard?.modifier_templates?.[side]?.includes(null),
    )
  );
}

/**
 * Every way a receipt is not the artifact a manifest entry names: its
 * digest, its key, its recorded digests, its years and unsupported years
 * (which decide what may be shown), for a combined run its members and
 * their output snapshot, any data limit it records (which means no
 * figure may be shown), and any model limit it records (which means its
 * figures may be shown as provisional only). Empty when it is.
 */
export async function receiptProblems(receipt, key, entry) {
  const problems = [];
  const dashboard = receipt?.dashboard ?? {};
  if (dashboard.disclosure_floor?.thin_cells_in_tables) {
    problems.push("its tables hold cells under the floor of survey households");
  }
  if ((await artifactSha256(receipt)) !== entry.artifact_sha256) {
    problems.push("the receipt is not the artifact the manifest names");
  }
  if (dashboard.key !== key) {
    problems.push("the receipt is for a different entry");
  }
  if (dashboard.name !== entry.name) {
    problems.push("the receipt's name is not the manifest's");
  }
  if (dashboard.description !== undefined && typeof dashboard.description !== "string") {
    problems.push("the receipt's description is not text");
  }
  if ((dashboard.description ?? "") !== (entry.description ?? "")) {
    problems.push("the receipt's description is not the manifest's");
  }
  problems.push(...personalSeriesProblems(dashboard.personal).map((problem) => `the receipt's ${problem}`));
  if (canonicalize(dashboard.personal ?? null) !== canonicalize(entry.personal ?? null)) {
    problems.push("the receipt's personal mapping is not the manifest's");
  }
  const digests = dashboard.digests ?? {};
  for (const field of [
    "outputs_sha256",
    "receipt_sha256",
    "execution_identity_sha256",
  ]) {
    if (digests[field] !== entry[field]) {
      problems.push(`the receipt's ${field} is not the manifest's`);
    }
  }
  if (!sameList(receipt?.execution_receipt?.years, entry.years)) {
    problems.push("the receipt's years are not the manifest's");
  }
  if (!sameList(dashboard.unsupported_years, entry.unsupported_years ?? [])) {
    problems.push("the receipt's unsupported years are not the manifest's");
  }
  if (Array.isArray(entry.measures)) {
    if (!sameSet(dashboard.measure_ids, entry.measures)) {
      problems.push("the receipt's members are not the manifest's");
    }
    const snapshot = dashboard.member_outputs_sha256 ?? {};
    const named = entry.member_outputs_sha256 ?? {};
    if (
      !sameSet(Object.keys(snapshot), Object.keys(named)) ||
      Object.keys(named).some((id) => snapshot[id] !== named[id])
    ) {
      problems.push("the receipt's member outputs are not the manifest's");
    }
  } else if (!sameSet(dashboard.measure_ids, [key])) {
    problems.push("the receipt names other measures");
  }
  // A measure the certified data cannot cost records its data limits in
  // its receipt; its figures are never shown, whatever the manifest says.
  // A receipt generated against another registry of limits (one added
  // since, say) is refused until it is regenerated.
  if (
    dashboard.data_limits_registry_sha256 !==
    contract.data_limits_registry_sha256
  ) {
    problems.push(
      "we generated the receipt against another data-limit registry",
    );
  }
  if (!Array.isArray(dashboard.data_limits)) {
    problems.push("the receipt does not record its data limits");
  } else if (dashboard.data_limits.length > 0) {
    problems.push(
      "the receipt records data limits: not computable on current data, " +
        "so we cannot show its figures",
    );
  }
  // A measure the installed model mis-costs records its model limits in its
  // receipt; it is held at provisional, so it is never shown as approved,
  // whatever the manifest says. The registry is bound as the data limits'
  // is.
  if (
    dashboard.model_limits_registry_sha256 !==
    contract.model_limits_registry_sha256
  ) {
    problems.push(
      "we generated the receipt against another model-limit registry",
    );
  }
  if (!Array.isArray(dashboard.model_limits)) {
    problems.push("the receipt does not record its model limits");
  } else if (
    dashboard.model_limits.length > 0 &&
    entry.status !== "provisional"
  ) {
    problems.push(
      "the receipt records model limits: it stays provisional, so we " +
        "cannot show it as approved",
    );
  }
  // Pure template proofs are recorded at generation time. Any hand-written
  // modifier, on either side or in a combined run, needs an attestation of
  // this complete receipt, including its generation timestamp and id.
  const templateProblems = modifierTemplatesProblems(receipt);
  problems.push(...templateProblems);
  if (templateProblems.length === 0 && isHeld(receipt)) {
    const attestation = entry.attestation;
    if (
      attestationProblems(attestation, key).length > 0 ||
      attestation.receipt_sha256 !== (await jcsSha256(receipt))
    ) {
      problems.push(
        "held: a hand-written modifier while a data limit is active " +
          "(coordinator's ruling on #51); attest it in " +
          `data_inputs/publication/attestations/${key}.json`,
      );
    }
  }
  return problems;
}

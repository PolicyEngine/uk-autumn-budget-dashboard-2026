/**
 * Approved definitions for test catalogues, and the household API's report
 * of them. Synthetic: one commit and one pair of identities for every
 * measure, never a real receipt's.
 */
import { receiptDefinition } from "../utils/publication/definitions";

export const APPROVED_COMMIT = "c".repeat(40);

/** The definition a test catalogue's receipt approved for a measure. */
export function approvedDefinition() {
  return {
    git_sha: APPROVED_COMMIT,
    baseline: { kind: "current_law", representation: null, reform_sha256: null, binding: "content" },
    reform: { kind: "reform", representation: "policyengine-uk.scenario/v1", reform_sha256: "d".repeat(64), binding: "content" },
  };
}

/** The `<id>: <commit>` pairs a request URL names, in its order. */
export function requestedDefinitions(url) {
  return new URL(url).searchParams.getAll("definition").map((value) => {
    const at = value.indexOf(":");
    return [value.slice(0, at), value.slice(at + 1)];
  });
}

/**
 * What an API running the approved code reports for the commits a request
 * names: `definitionFor(id)` recomputed at each one.
 */
export function reportedDefinitions(url, definitionFor = approvedDefinition) {
  return Object.fromEntries(
    requestedDefinitions(url).map(([id, gitSha]) => [id, { ...definitionFor(id), git_sha: gitSha }]),
  );
}

/** A measure's definition as its fixture receipt approved it. */
export function receiptDefinitionFor(fixtureJson) {
  const { measures } = fixtureJson("manifest.json");
  return (id) => receiptDefinition(fixtureJson(`${measures[id].artifact}/receipt.json`));
}

/** The request URL without its query: the route a request went to. */
export const route = (url) => String(url).split("?")[0];

/**
 * A successful JSON answer with the definitions an API running the
 * approved code would report beside it; any other response as it is.
 */
export async function withReportedDefinitions(response, url, definitionFor = approvedDefinition) {
  if (!response.ok) return response;
  const answer = await response.clone().json();
  return new Response(JSON.stringify({ ...answer, definitions: reportedDefinitions(url, definitionFor) }), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

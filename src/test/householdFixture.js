/**
 * The household API's answer from the single-year fixture
 * (fixtures/householdImpact.json, shaped as the Single-year effect's
 * contract), sliced as the API answers each stage: without `by_policy` or
 * `sweep` in `include`, those parts are left out.
 */
import fixture from "./fixtures/householdImpact.json";

export const HOUSEHOLD_FIXTURE = fixture;

/** The fixture as the API would answer `body` (a request object or its JSON). */
export function householdAnswerFor(body) {
  const request = typeof body === "string" ? JSON.parse(body) : body ?? {};
  const include = request.include ?? [];
  const answer = { ...fixture, year: request.year ?? fixture.year };
  if (!include.includes("by_policy")) delete answer.by_policy;
  if (!include.includes("sweep")) delete answer.sweep;
  return answer;
}

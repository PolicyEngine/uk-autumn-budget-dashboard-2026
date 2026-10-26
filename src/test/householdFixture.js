/**
 * The household API's answer from the single-year fixture
 * (fixtures/householdImpact.json), a real answer captured from the API
 * (`uv run uk-budget-api`, 24 October 2026, policyengine 6.10.1) to this
 * request, every measure, both parts:
 *
 *   { year: 2029, include: ["by_policy", "sweep"], household: {
 *     age: 38, employment_income: 32000, has_partner: true, partner_age: 36,
 *     partner_employment_income: 12000,
 *     children: [{ age: 9 }, { age: 6 }, { age: 2 }], region: "NORTH_WEST",
 *     claims_universal_credit: true, tenure: "RENT_PRIVATELY",
 *     monthly_rent: 900, monthly_childcare: 300, petrol_spending: 500 } }
 *
 * Sliced as the API answers each stage: without `by_policy` or `sweep` in
 * `include`, those parts are null.
 */
import fixture from "./fixtures/householdImpact.json";

export const HOUSEHOLD_FIXTURE = fixture;

/** The fixture as the API would answer `body` (a request object or its JSON). */
export function householdAnswerFor(body) {
  const request = typeof body === "string" ? JSON.parse(body) : body ?? {};
  const include = request.include ?? ["by_policy", "sweep"];
  const answer = { ...fixture, year: request.year ?? fixture.year };
  // The real route reports only unmodelled measures in this request.
  if (Array.isArray(request.policies)) {
    answer.not_modelled = fixture.not_modelled.filter((measure) => request.policies.includes(measure.id));
  }
  if (!include.includes("by_policy")) answer.by_policy = null;
  if (!include.includes("sweep")) answer.sweep = null;
  return answer;
}

/**
 * The Household impact view's API: one household, one year, before and after
 * the selected policies. Everything that knows the API's shape is in this
 * module (the URL, the request, the errors and the response), so a change
 * to the backend's contract is a change here only.
 *
 * The contract is the backend's: `HouseholdImpactRequest` in
 * src/uk_budget_data/api.py (it refuses unknown fields with a 422) and the
 * answer `calculate_household_impact` in household_impact.py builds.
 *
 *   POST NEXT_PUBLIC_HOUSEHOLD_API_URL   (…/api/household-impact)
 *   { year, policies, household: {…}, include: [...] }
 *
 * The page asks first for `include: []` (the headline and the programmes),
 * then, at once, for `include: ["sweep"]` (the earnings sweep, two runs) and
 * `include: ["by_policy"]` (one run per measure). The two later requests
 * share the instance's worker slots fairly, so the sweep's two runs are not
 * queued behind every measure's run: the earnings charts arrive without
 * waiting for the split by policy. A part a request did not compute comes
 * back as null; `normaliseHouseholdImpact` turns the answer into the page's
 * own shape.
 */

import statePensionTable from "../uk_budget_data/state_pension.json";
import { DEFAULT_SPENDING, regionalRent } from "./householdDefaults";
import contract from "./publication/contract.json";
import { definitionDifferences, definitionQuery } from "./publication/definitions";

export const HOUSEHOLD_API_VAR = "NEXT_PUBLIC_HOUSEHOLD_API_URL";

/**
 * How long each stage may take before the page gives up. The headline is
 * two runs (a few seconds); the breakdown is one run per measure plus the
 * sweep, about 20 s alone, and when several visitors share an instance
 * their runs share its worker processes, so it can take a few times that.
 * Both are under Cloud Run's 300 s request limit and the server's own 280 s
 * limit (HOUSEHOLD_CALCULATION_TIMEOUT), which answers 504.
 */
export const REQUEST_TIMEOUT_MS = 90_000;
export const DETAIL_TIMEOUT_MS = 200_000;

/** The year the wizard's salary is entered for; the server grows it. */
export const SALARY_YEAR = 2026;

/** The requests of a calculation: the headline, then the detail parts. */
export const HEADLINE_INCLUDE = [];
export const SWEEP_INCLUDE = ["sweep"];
export const BY_POLICY_INCLUDE = ["by_policy"];
/** The detail parts, each asked for on its own and at once, sweep first. */
export const DETAIL_PARTS = [SWEEP_INCLUDE, BY_POLICY_INCLUDE];

/** The API's field names, as the wizard labels them (for error messages). */
export const FIELD_LABELS = {
  year: "Year",
  policies: "Policies",
  age: "Age",
  employment_income: "Salary",
  has_partner: "Partner",
  partner_age: "Partner's age",
  partner_employment_income: "Partner's salary",
  children: "Children's ages",
  region: "Region",
  claims_universal_credit: "Universal Credit",
  tenure: "Housing",
  monthly_rent: "Monthly rent",
  dividend_income: "Dividends",
  savings_interest_income: "Savings interest",
  property_income: "Property income",
  petrol_spending: "Petrol spending",
  diesel_spending: "Diesel spending",
  electricity_spending: "Electricity spending",
  salary_sacrifice_pension_contributions: "Salary sacrifice",
  student_loan_plan: "Student loan plan",
  council_tax_band: "Council tax band",
  monthly_childcare: "Monthly childcare",
  salary_year: "Salary year",
  private_pension_income: "Private pension",
  partner_private_pension_income: "Partner's private pension",
  in_education: "In full-time education",
  state_pension: "State Pension",
  partner_state_pension: "Partner's State Pension",
};

/**
 * policyengine-uk's State Pension age and full new State Pension (£ a
 * year) in `year`, from state_pension.json (a test checks it against the
 * model). The wizard shows its State Pension fields from this age and
 * prefills them with this amount; the API reads the model itself, so a
 * field left as prefilled is not sent.
 *
 * @param {number} year
 * @returns {{ age: number, full: number }}
 */
export function statePensionFor(year) {
  const years = statePensionTable.years;
  const known = Object.keys(years).map(Number).sort((a, b) => a - b);
  const nearest = known.find((y) => y >= year) ?? known[known.length - 1];
  const row = years[String(known.includes(year) ? year : nearest)];
  return { age: row.state_pension_age, full: row.full_new_state_pension };
}

/** Whether someone of `age` is at State Pension age in `year`. */
export const atStatePensionAge = (age, year) => age >= statePensionFor(year).age;

/** The API's URL, or null when the build has none. */
export function householdApiUrl() {
  const url = process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL;
  return url ? url.trim() : null;
}

/**
 * An optional second URL for the slow parts (the sweep and the split by
 * policy): the same API run with its simulations fanned out on Modal
 * (`modal_household.py`). Null when unset, and then every request goes to
 * householdApiUrl().
 */
export const HOUSEHOLD_DETAIL_API_VAR = "NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL";
export function householdDetailApiUrl() {
  const url = process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL;
  return url ? url.trim() : null;
}

/** An error the Household impact view can explain: `kind` says which. */
export class HouseholdApiError extends Error {
  /**
   * @param {"config"|"timeout"|"network"|"invalid"|"server"} kind
   * @param {string} message
   * @param {{ status?: number, fields?: Array<{field: string, label: string, message: string}> }} [extra]
   */
  constructor(kind, message, { status, fields = [] } = {}) {
    super(message);
    this.name = "HouseholdApiError";
    this.kind = kind;
    this.status = status;
    this.fields = fields;
  }
}

/** The oldest age the form takes for a child (policyengine-uk's
 * qualifying young person limit is under 20). */
export const OLDEST_CHILD_AGE = 19;
/** From this age, whether a child is in full-time non-advanced education
 * decides whether they count. */
export const YOUNG_PERSON_AGE = 16;

/** What the form says, and the API is told, about a child of 20 or over. */
export const CHILD_AGE_MESSAGE =
  "Children are 0 to 19. Someone aged 20 or over is not a dependant for Child Benefit or Universal Credit, so leave them out.";

/**
 * Children's ages from the wizard's text ("5, 3, 1"). An age of 20 or over
 * is kept, not dropped, so the calculation refuses it with a message
 * (`CHILD_AGE_MESSAGE`) rather than leaving the child out silently.
 */
export function parseChildrenAges(value) {
  if (!value || String(value).trim() === "") return [];
  return String(value)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

/** Whether a child of `age` is asked about education (16 to 19). */
export const asksEducation = (age) => age >= YOUNG_PERSON_AGE && age <= OLDEST_CHILD_AGE;

/**
 * Each child as the API takes them: their age, and from 16 to 19 whether
 * they are in full-time non-advanced education (school or college), as
 * answered, yes until answered.
 */
export function childrenForRequest(inputs) {
  const education = Array.isArray(inputs.children_in_education) ? inputs.children_in_education : [];
  return parseChildrenAges(inputs.children_ages).map((age, index) =>
    asksEducation(age) ? { age, in_education: education[index] !== false } : { age },
  );
}

const RENTING = new Set(["RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA"]);
export const isRenting = (tenure) => RENTING.has(tenure);

/**
 * The request body for the wizard's answers.
 *
 * @param {Object} inputs - The wizard's state (HouseholdCalculator)
 * @param {{ year: number, policies: string[], include?: string[] }} options
 */
export function buildHouseholdRequest(inputs, { year, policies, include = HEADLINE_INCLUDE }) {
  const children = childrenForRequest(inputs);
  const renting = isRenting(inputs.tenure);
  return {
    year,
    policies: [...policies],
    household: {
      age: inputs.current_age,
      employment_income: inputs.current_salary,
      has_partner: Boolean(inputs.has_partner),
      partner_age: inputs.partner_age,
      partner_employment_income: inputs.has_partner ? inputs.partner_salary : 0,
      children,
      region: inputs.region,
      claims_universal_credit: Boolean(inputs.claims_universal_credit),
      tenure: inputs.tenure,
      // Left as prefilled (null), the region's average private rent
      monthly_rent: renting ? monthlyRent(inputs) : 0,
      dividend_income: inputs.dividends_per_year,
      savings_interest_income: inputs.savings_interest_per_year,
      private_pension_income: inputs.private_pension_per_year ?? 0,
      partner_private_pension_income: inputs.has_partner ? (inputs.partner_private_pension_per_year ?? 0) : 0,
      property_income: inputs.property_income_per_year,
      petrol_spending: inputs.petrol_spending_per_year,
      diesel_spending: inputs.diesel_spending_per_year,
      electricity_spending: inputs.electricity_spending_per_year ?? DEFAULT_SPENDING.electricity,
      salary_sacrifice_pension_contributions: inputs.salary_sacrifice_per_year,
      student_loan_plan: inputs.student_loan_plan,
      // The API estimates Council Tax from the band and the region's average
      // Band D (none in Northern Ireland, which has domestic rates)
      council_tax_band: inputs.council_tax_band,
      // Childcare only counts with children
      monthly_childcare: children.length ? inputs.monthly_childcare : 0,
      salary_year: SALARY_YEAR,
      // The State Pension only as entered: left as prefilled, the API uses
      // the full new State Pension for the year
      ...(statePensionEntered(inputs.state_pension_per_year) && atStatePensionAge(inputs.current_age, year)
        ? { state_pension: inputs.state_pension_per_year }
        : {}),
      ...(inputs.has_partner &&
      statePensionEntered(inputs.partner_state_pension_per_year) &&
      atStatePensionAge(inputs.partner_age, year)
        ? { partner_state_pension: inputs.partner_state_pension_per_year }
        : {}),
    },
    include: [...include],
  };
}

/** The rent a month: as entered, else the region's average private rent. */
export const monthlyRent = (inputs) =>
  typeof inputs.monthly_rent === "number" && Number.isFinite(inputs.monthly_rent)
    ? inputs.monthly_rent
    : regionalRent(inputs.region);

const statePensionEntered = (value) => typeof value === "number" && Number.isFinite(value);

/** One request's cache key: the body without the stage. */
export function requestKey(body) {
  const { include: _include, ...rest } = body;
  return JSON.stringify(rest);
}

/** How the API words a measure its code doesn't register (`uk_budget_data.definitions.UNREGISTERED`). */
export const UNREGISTERED = contract.definition_unregistered;

/**
 * The requested measures a 422 says the running code doesn't register
 * (`HouseholdImpactRequest._known_measures`: "Unknown measures: a, b" on
 * `policies`), in id order. Empty unless every one it names was
 * requested, so any other refusal keeps its own message.
 *
 * @param {*} detail - The 422's `detail`
 * @param {string[]} requested - The request's `policies`
 * @returns {string[]}
 */
export function unregisteredMeasures(detail, requested) {
  if (!Array.isArray(detail) || !Array.isArray(requested)) return [];
  const named = new Set();
  for (const item of detail) {
    const loc = Array.isArray(item?.loc) ? item.loc.filter((part) => part !== "body") : [];
    const match = /Unknown measures: (.+)$/.exec(typeof item?.msg === "string" ? item.msg : "");
    if (loc.length !== 1 || loc[0] !== "policies" || !match) return [];
    for (const id of match[1].split(", ")) named.add(id);
  }
  const ids = [...named].sort();
  return ids.length > 0 && ids.every((id) => requested.includes(id)) ? ids : [];
}

/** "household.age" from FastAPI's ["body", "household", "age"]. */
function fieldErrors(detail) {
  if (!Array.isArray(detail)) return [];
  return detail.map((item) => {
    const loc = (item?.loc ?? []).filter((part) => part !== "body");
    // A child's answer is the children's, not the head's (children.0.age)
    const name = loc.includes("children")
      ? "children"
      : ([...loc].reverse().find((part) => typeof part === "string") ?? "");
    // A child too old to count: say what to do, not the bound
    const tooOld = name === "children" && loc[loc.length - 1] === "age" && item?.type === "less_than_equal";
    return {
      field: loc.join("."),
      label: FIELD_LABELS[name] ?? (name ? name.replace(/_/g, " ") : "Answer"),
      message: tooOld ? CHILD_AGE_MESSAGE : String(item?.msg ?? "is not valid"),
    };
  });
}

/**
 * The response's body as JSON, or null if it isn't JSON or can't be read;
 * rejects with the signal's reason once the signal aborts, even if the body
 * never ends.
 */
function readJson(response, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("The read was aborted.", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => response.json())
      .then(resolve, () => resolve(null))
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * POST one stage. Resolves with the parsed JSON; rejects with a
 * HouseholdApiError, or a DefinitionMismatchError naming any selected
 * measures the running code doesn't register (an abort by the caller
 * rejects with the AbortError).
 *
 * @param {Object} body - From buildHouseholdRequest
 * @param {{ signal?: AbortSignal, timeoutMs?: number, fetchImpl?: typeof fetch,
 *   definitions?: Object<string, {git_sha: string}>, url?: string }} [options] -
 *   `definitions`: the asked measures' approved definitions, whose
 *   commits the request names so the answer reports each measure's
 *   definition at its own (`definitions` in the answer); `url`: another
 *   address for the same API (the detail URL), which takes the same query
 */
export async function postHouseholdImpact(
  body,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl, definitions, url: urlOverride } = {},
) {
  const apiUrl = urlOverride ?? householdApiUrl();
  if (!apiUrl) {
    throw new HouseholdApiError(
      "config",
      `${HOUSEHOLD_API_VAR} is not set, so this build cannot calculate a household.`,
    );
  }
  // A query, not the body: a build that predates them still takes the body
  const query = definitionQuery(definitions);
  const url = query ? `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${query}` : apiUrl;
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  // A signal aborted before this call never fires its event
  if (signal?.aborted) controller.abort();
  let response;
  let payload;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // The timeout and the caller's abort hold until the body is read: a
    // body that stalls is a timeout, so a detail service's stalled answer
    // falls back to the main API instead of leaving the part loading
    payload = await readJson(response, controller.signal);
  } catch (err) {
    if (timedOut) {
      throw new HouseholdApiError(
        "timeout",
        `The calculation took longer than ${Math.round(timeoutMs / 1000)} seconds.`,
      );
    }
    if (signal?.aborted) throw err;
    throw new HouseholdApiError("network", "The calculation service could not be reached.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (response.ok) {
    if (!payload || typeof payload !== "object" || !payload.net_income) {
      throw new HouseholdApiError("server", "The calculation service sent an answer this page cannot read.", {
        status: response.status,
      });
    }
    return payload;
  }
  const detail = payload?.detail;
  // Measures the running code doesn't register (one published before the
  // deploy that adds it, or after a rollback): unavailable, as a definition
  // the running code can't bind is
  const unregistered = response.status === 422 ? unregisteredMeasures(detail, body.policies) : [];
  if (unregistered.length) {
    throw new DefinitionMismatchError(
      unregistered.map((id) => ({ id, problems: [`the running code cannot bind it: ${UNREGISTERED}`] })),
    );
  }
  if (response.status === 422 && Array.isArray(detail)) {
    const fields = fieldErrors(detail);
    throw new HouseholdApiError("invalid", "Some answers are outside what the calculation accepts.", {
      status: 422,
      fields,
    });
  }
  if (response.status === 400 || response.status === 422) {
    throw new HouseholdApiError(
      "invalid",
      typeof detail === "string" ? detail : "The calculation did not accept these answers.",
      { status: response.status },
    );
  }
  if (response.status === 504 || response.status === 408) {
    throw new HouseholdApiError("timeout", "The calculation took too long.", {
      status: response.status,
    });
  }
  throw new HouseholdApiError("server", `The calculation service answered with an error (${response.status}).`, {
    status: response.status,
  });
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function normaliseProgramme(row) {
  return {
    id: String(row.id),
    group: row.group ?? "benefit",
    label: row.label ?? null,
    note: row.note ?? null,
    before: num(row.baseline),
    after: num(row.reform),
    // The API's own change: before and after are each rounded to the penny
    change: typeof row.change === "number" ? row.change : num(row.reform) - num(row.baseline),
    children: Array.isArray(row.children) ? row.children.map(normaliseProgramme) : [],
  };
}

function normaliseByPolicy(raw) {
  if (!raw || !Array.isArray(raw.measures)) return null;
  return {
    measures: raw.measures.map((row) => ({
      id: String(row.id),
      name: row.name ?? null,
      change: num(row.change),
      status: row.status === "not_affected" ? "not_affected" : "affected",
      // A note where the number alone would mislead: "employer_cost" (£0 by
      // construction) or "if_received" (the eligible amount)
      note: row.note ?? null,
      noteKind: row.note_kind ?? null,
    })),
    combined: num(raw.combined),
    sumOfSingles: num(raw.sum_of_singles),
    residual: num(raw.residual),
  };
}

function normaliseSweep(raw) {
  if (!raw || !Array.isArray(raw.points) || raw.points.length < 2) return null;
  const points = raw.points.map((point) => ({
    income: num(point.employment_income),
    before: num(point.baseline),
    after: num(point.reform),
    change: num(point.change),
  }));
  const own = raw.own_point;
  return {
    points,
    rates: (raw.marginal_rates ?? []).map((rate) => ({
      income: num(rate.from),
      to: num(rate.to),
      before: num(rate.baseline),
      after: num(rate.reform),
    })),
    own: own
      ? {
          income: num(own.employment_income),
          before: num(own.baseline),
          after: num(own.reform),
          beforeRate: numOrNull(own.baseline_marginal_rate),
          afterRate: numOrNull(own.reform_marginal_rate),
        }
      : null,
    min: points[0].income,
    max: points[points.length - 1].income,
  };
}

/**
 * The page's own shape for an answer. Parts a stage did not compute are
 * null, so the page can tell "not yet" from "none".
 */
export function normaliseHouseholdImpact(raw) {
  const salary = raw.salary_used ?? {};
  const area = raw.area ?? null;
  return {
    year: raw.year,
    salaryUsed: numOrNull(salary.employment_income),
    partnerSalaryUsed: numOrNull(salary.partner_employment_income),
    salaryYear: salary.salary_year ?? SALARY_YEAR,
    net: {
      before: num(raw.net_income?.baseline),
      after: num(raw.net_income?.reform),
      change: num(raw.net_income?.change),
    },
    included: raw.included ?? [],
    notModelled: (raw.not_modelled ?? []).map((item) => ({
      id: String(item.id),
      name: item.name ?? null,
      reason: item.reason ?? "",
    })),
    programmes: Array.isArray(raw.programmes) ? raw.programmes.map(normaliseProgramme) : null,
    byPolicy: normaliseByPolicy(raw.by_policy),
    sweep: normaliseSweep(raw.sweep),
    dependants: (raw.dependants ?? []).map((child) => ({
      age: num(child.age),
      countsForChildBenefit: Boolean(child.counts_for_child_benefit),
      countsForUniversalCredit: Boolean(child.counts_for_universal_credit),
    })),
    dependantsNote: raw.dependants_note ?? null,
    councilTax: raw.council_tax_used
      ? {
          amount: num(raw.council_tax_used.council_tax),
          band: raw.council_tax_used.band ?? null,
          source: raw.council_tax_used.source ?? null,
        }
      : null,
    area: area
      ? {
          region: area.region ?? null,
          brma: area.brma ?? null,
          brmaDefault: area.brma_source === "region default",
        }
      : null,
    engine: raw.engine ?? {},
    // Each named measure's definition as the API's code gives it at the
    // approved commit; null from a build that reports none
    definitions:
      raw.definitions && typeof raw.definitions === "object" && !Array.isArray(raw.definitions)
        ? raw.definitions
        : null,
    // The build's commit, or null when the build reports none (a local run,
    // a Modal deploy from an edited checkout, or a build older than this)
    build: buildOf(raw.git_sha),
    // Every commit this result's stages reported (mergeStages adds each
    // part's); `build` stays the headline's own
    builds: buildOf(raw.git_sha) === null ? [] : [buildOf(raw.git_sha)],
  };
}

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * An answer's build commit: the commit, null when the answer reports none,
 * or for anything else an object that stands for it and equals no build,
 * not even another copy of itself.
 */
function buildOf(value) {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && FULL_COMMIT.test(value) ? value : { malformed: String(value) };
}

/** Two reported builds are one only as the same well-formed commit. */
const sameCommit = (a, b) => typeof a === "string" && a === b;

/** A build commit that was reported but isn't one. */
const malformed = (build) => build != null && typeof build !== "string";

/** Every commit a result's stages have reported so far. */
const buildsSeen = (result) => result.builds ?? (result.build == null ? [] : [result.build]);

/**
 * The household API's answer came from other package versions than the
 * published figures, or than its own other stage. Personal impact is then
 * unavailable: the figures beside it were not calculated by that model.
 */
export class EngineMismatchError extends Error {
  constructor(packages) {
    super(`The household calculator runs other model versions (${packages.join(", ")}) than the published figures`);
    this.name = "EngineMismatchError";
    this.kind = "engine";
    this.packages = packages;
  }
}

/**
 * The packages whose versions differ: every package `expected` names that
 * `reported` lacks or gives another version. Packages only `reported`
 * names (uk_budget_data, which no receipt records) are not compared.
 *
 * @param {Object<string, string>} expected
 * @param {Object<string, string>} reported
 * @returns {string[]} sorted package names
 */
export function engineDifferences(expected, reported) {
  const given = reported && typeof reported === "object" ? reported : {};
  return Object.keys(expected ?? {})
    .filter((name) => typeof given[name] !== "string" || given[name] !== expected[name])
    .sort();
}

/**
 * The household API's code does not compute some selected measures from
 * the definitions their published figures were approved on (or could not
 * say). Household impact is then unavailable for them: `refused` names each,
 * with how its definition differs. `unchecked`: the answer reported no
 * definitions at all (a build before #125), so nothing could be checked.
 */
export class DefinitionMismatchError extends Error {
  constructor(refused, { unchecked = false } = {}) {
    super(
      `The household calculator does not compute ${refused.map((item) => item.id).join(", ")} ` +
        "from the definitions their published figures were approved on",
    );
    this.name = "DefinitionMismatchError";
    this.kind = "definition";
    this.refused = refused;
    this.unchecked = unchecked;
  }
}

/**
 * The model packages a calculation's stages must share. uk_budget_data is
 * left out: every build reports the same project version for it, and a build
 * that doesn't install the project (the Modal image copies it in as a
 * folder) reports none, so it tells two deployments apart only wrongly.
 */
export const STAGE_ENGINE_PACKAGES = ["policyengine", "policyengine-core", "policyengine-uk"];

/** A detail answer's net income may differ from the headline's by this many pennies. */
const NET_TOLERANCE_PENNIES = 1;

const pennies = (pounds) => Math.round(pounds * 100);

/**
 * The breakdown came from another deployment than its headline: its model
 * packages differ, it reports another build commit, or it recomputed another
 * net income for the same household.
 */
export class StageMismatchError extends EngineMismatchError {
  constructor(packages) {
    super(packages);
    this.name = "StageMismatchError";
    this.message = `The household calculator's breakdown came from another build than its headline (${packages.join(", ")})`;
  }
}

/**
 * The selected measures whose reported definition differs from the
 * approved one, in id order. A measure with no approved definition, or
 * none reported, is refused: nothing is answered unchecked.
 *
 * @param {Object<string, Object>} expected - Approved definitions by id
 * @param {Object<string, Object>|null} reported - The answer's `definitions`
 * @param {string[]} [ids] - The selected measures (default: those expected)
 * @returns {Array<{id: string, problems: string[]}>}
 */
export function definitionRefusals(expected, reported, ids = Object.keys(expected ?? {})) {
  const approved = expected ?? {};
  const given = reported && typeof reported === "object" && !Array.isArray(reported) ? reported : {};
  return [...new Set(ids)]
    .sort()
    .map((id) => ({
      id,
      problems: Object.hasOwn(approved, id)
        ? definitionDifferences(approved[id], Object.hasOwn(given, id) ? given[id] : undefined)
        : ["no approved definition to check it against"],
    }))
    .filter((item) => item.problems.length > 0);
}

/**
 * Why a detail answer can't sit under this headline, or null if it can.
 *
 * Net income alone can't show two answers came from one build: two builds
 * can agree on this household's net income and still differ elsewhere on
 * its earnings sweep. Only the build commit can.
 *
 * - A part that reports a commit must report the one every stage so far
 *   has reported (`first.builds`: the headline's and each merged part's),
 *   so two parts from different builds never meet, even under a headline
 *   that reports none (review of e78fbf4, finding 2).
 * - `sameBuild` (the detail service's answers) also needs the headline
 *   itself to report that commit. A merged part's commit never stands in
 *   for it.
 * - A malformed commit from either side refuses the part, even beside
 *   answers that report none (review of cc15d50, finding 2).
 *
 * @param {Object} first - The headline, with any parts merged so far
 * @param {Object} detail - A later part
 * @param {{ sameBuild?: boolean }} [options]
 * @returns {StageMismatchError|null}
 */
export function stageMismatch(first, detail, { sameBuild = false } = {}) {
  const a = first.engine ?? {};
  const b = detail.engine ?? {};
  const packages = STAGE_ENGINE_PACKAGES.filter((name) => typeof a[name] !== "string" || a[name] !== b[name]);
  if (packages.length) return new StageMismatchError(packages);
  const theirs = detail.build ?? null;
  const otherBuild =
    [theirs, first.build, ...buildsSeen(first)].some(malformed) ||
    (sameBuild && !sameCommit(first.build, theirs)) ||
    (theirs !== null && buildsSeen(first).some((build) => !sameCommit(build, theirs)));
  if (otherBuild) return new StageMismatchError(["build"]);
  const sameNet = ["before", "after"].every(
    (side) =>
      Number.isFinite(first.net?.[side]) &&
      Number.isFinite(detail.net?.[side]) &&
      Math.abs(pennies(first.net[side]) - pennies(detail.net[side])) <= NET_TOLERANCE_PENNIES,
  );
  return sameNet ? null : new StageMismatchError(["net_income"]);
}

/**
 * A later stage's parts added to the first stage's result. Both stages must
 * come from the same build: a breakdown from another deployment never sits
 * under a headline from this one.
 *
 * @throws {StageMismatchError} when the stages' model packages, build
 *   commits or net income differ
 */
export function mergeStages(first, detail) {
  const mismatch = stageMismatch(first, detail);
  if (mismatch) throw mismatch;
  const seen = buildsSeen(first);
  return {
    ...first,
    byPolicy: detail.byPolicy ?? first.byPolicy,
    sweep: detail.sweep ?? first.sweep,
    programmes: first.programmes ?? detail.programmes,
    // The check above leaves every seen commit equal to the part's
    builds: detail.build == null || seen.length ? seen : [detail.build],
  };
}

/**
 * Whole pounds that add up to the rounded total (largest remainder): each
 * value rounded, then the rows whose rounding moved them furthest nudged by
 * £1 until the sum matches. Used only when the values already sum to the
 * total within £1.
 *
 * @param {number[]} values
 * @param {number} total
 * @returns {number[]}
 */
export function consistentRound(values, total) {
  const rounded = values.map((value) => Math.round(value));
  let diff = Math.round(total) - rounded.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, residual: value - rounded[index] }))
    // Most under-rounded first when adding, most over-rounded when taking
    .sort((a, b) => (diff > 0 ? b.residual - a.residual : a.residual - b.residual));
  for (let i = 0; diff !== 0 && i < order.length * 2; i += 1) {
    const { index } = order[i % order.length];
    const step = diff > 0 ? 1 : -1;
    rounded[index] += step;
    diff -= step;
  }
  return rounded.map((value) => (Object.is(value, -0) ? 0 : value));
}

/**
 * A detail part (sweep or split by policy): from the detail URL when the
 * build has one, falling back to the main API if that service cannot be
 * reached, errs, times out, refuses the request (an older build may not know
 * a measure, or register it: a DefinitionMismatchError) or answers with
 * something `accept` refuses (not the headline's build, or other measure
 * definitions). The main API's answer, or its refusal, is returned as it
 * is: the caller checks it again.
 *
 * @param {Object} body
 * @param {Object} [options] - postHouseholdImpact's options, plus
 *   `accept(raw) => boolean` for the detail URL's answer
 */
export async function postHouseholdDetail(body, { accept = null, ...options } = {}) {
  const detailUrl = householdDetailApiUrl();
  if (!detailUrl) return postHouseholdImpact(body, options);
  try {
    const raw = await postHouseholdImpact(body, { ...options, url: detailUrl });
    if (!accept || accept(raw)) return raw;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!(error instanceof HouseholdApiError || error instanceof DefinitionMismatchError)) throw error;
  }
  return postHouseholdImpact(body, options);
}

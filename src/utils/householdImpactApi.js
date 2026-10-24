/**
 * The Single-year effect's API: one household, one year, before and after
 * the selected policies. Everything that knows the API's shape is in this
 * module (the URL, the request, the errors and the response), so a change
 * to the backend's contract is a change here only.
 *
 * Contract: single-year-spec.md §6 (the design spec for this sub-tab).
 *
 *   POST NEXT_PUBLIC_HOUSEHOLD_API_URL   (…/api/household-impact)
 *   { year, policies, household: {…}, include: [...] }
 *
 * The page asks in two stages: first `include: []` (the headline and the
 * programmes), then `include: ["by_policy", "sweep"]` (the per-policy split
 * and the earnings sweep), which are slower. A response may carry more than
 * was asked for; `normaliseHouseholdImpact` reads whatever is there.
 *
 * Response (§6.2), as `normaliseHouseholdImpact` reads it:
 *   year, salary_used,
 *   net_income: { before, after, change },
 *   measures: { included: [id], not_affected: [id], not_modelled: [{ id, reason }] },
 *   programmes: [{ id, group: "tax" | "benefit" | "income", before, after,
 *                  label?, children?: [{ id, before, after, label? }] }],
 *     (taxes as the positive amounts paid; the page shows them as negative)
 *   by_policy: [{ id, change }]   (cumulative in the publication's order)
 *   sweep: { variable, min, max, count, income: [], before: [], after: [] },
 *   versions: { … }
 */

export const HOUSEHOLD_API_VAR = "NEXT_PUBLIC_HOUSEHOLD_API_URL";

/** The route's own limit is 60 s; give up a little after it. */
export const REQUEST_TIMEOUT_MS = 65_000;

/** The year the wizard's salary is entered for; the server grows it. */
export const SALARY_YEAR = 2026;

/** The two stages of a calculation. */
export const HEADLINE_INCLUDE = [];
export const DETAIL_INCLUDE = ["by_policy", "sweep"];

/** The API's field names, as the wizard labels them (for error messages). */
export const FIELD_LABELS = {
  year: "Year",
  policies: "Policies",
  age: "Age",
  employment_income: "Salary",
  has_partner: "Partner",
  partner_age: "Partner's age",
  partner_employment_income: "Partner's salary",
  children_ages: "Children's ages",
  region: "Region",
  claims_universal_credit: "Universal Credit",
  tenure: "Housing",
  monthly_rent: "Monthly rent",
  dividend_income: "Dividends",
  savings_interest_income: "Savings interest",
  property_income: "Property income",
  petrol_spending: "Petrol spending",
  diesel_spending: "Diesel spending",
  salary_sacrifice_pension_contributions: "Salary sacrifice",
  student_loan_plan: "Student loan plan",
  council_tax_band: "Council tax band",
  monthly_childcare: "Monthly childcare",
  salary_year: "Salary year",
};

/** The API's URL, or null when the build has none. */
export function householdApiUrl() {
  const url = process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL;
  return url ? url.trim() : null;
}

/** An error the Single-year view can explain: `kind` says which. */
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

/** Children's ages from the wizard's text ("5, 3, 1"). */
export function parseChildrenAges(value) {
  if (!value || String(value).trim() === "") return [];
  return String(value)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0 && n < 20);
}

const RENTING = new Set(["RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA"]);
export const isRenting = (tenure) => RENTING.has(tenure);

/**
 * The request body for the wizard's answers.
 *
 * @param {Object} inputs - The wizard's state (LifecycleCalculator)
 * @param {{ year: number, policies: string[], include?: string[] }} options
 */
export function buildHouseholdRequest(inputs, { year, policies, include = HEADLINE_INCLUDE }) {
  const children = parseChildrenAges(inputs.children_ages);
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
      children_ages: children,
      region: inputs.region,
      claims_universal_credit: Boolean(inputs.claims_universal_credit),
      tenure: inputs.tenure,
      monthly_rent: renting ? inputs.monthly_rent : 0,
      dividend_income: inputs.dividends_per_year,
      savings_interest_income: inputs.savings_interest_per_year,
      property_income: inputs.property_income_per_year,
      petrol_spending: inputs.petrol_spending_per_year,
      diesel_spending: inputs.diesel_spending_per_year,
      salary_sacrifice_pension_contributions: inputs.salary_sacrifice_per_year,
      student_loan_plan: inputs.student_loan_plan,
      council_tax_band: inputs.council_tax_band,
      // Childcare only counts with children
      monthly_childcare: children.length ? inputs.monthly_childcare : 0,
      salary_year: SALARY_YEAR,
    },
    include: [...include],
  };
}

/** One request's cache key: the body without the stage. */
export function requestKey(body) {
  const { include: _include, ...rest } = body;
  return JSON.stringify(rest);
}

/** "household.age" from FastAPI's ["body", "household", "age"]. */
function fieldErrors(detail) {
  if (!Array.isArray(detail)) return [];
  return detail.map((item) => {
    const loc = (item?.loc ?? []).filter((part) => part !== "body");
    const name = [...loc].reverse().find((part) => typeof part === "string") ?? "";
    return {
      field: loc.join("."),
      label: FIELD_LABELS[name] ?? (name ? name.replace(/_/g, " ") : "Answer"),
      message: String(item?.msg ?? "is not valid"),
    };
  });
}

/**
 * POST one stage. Resolves with the parsed JSON; rejects with a
 * HouseholdApiError (an abort by the caller rejects with the AbortError).
 *
 * @param {Object} body - From buildHouseholdRequest
 * @param {{ signal?: AbortSignal, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function postHouseholdImpact(
  body,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl } = {},
) {
  const url = householdApiUrl();
  if (!url) {
    throw new HouseholdApiError(
      "config",
      `${HOUSEHOLD_API_VAR} is not set, so this build cannot calculate a single year.`,
    );
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  let response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
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

function normaliseProgramme(row) {
  return {
    id: String(row.id),
    group: row.group ?? "benefit",
    label: row.label ?? null,
    before: num(row.before),
    after: num(row.after),
    children: Array.isArray(row.children) ? row.children.map(normaliseProgramme) : [],
  };
}

/**
 * The page's own shape for a response (§6.2). Parts a stage did not
 * return are null, so the page can tell "not yet" from "none".
 */
export function normaliseHouseholdImpact(raw) {
  const measures = raw.measures ?? {};
  const sweep = raw.sweep;
  return {
    year: raw.year,
    salaryUsed: typeof raw.salary_used === "number" ? raw.salary_used : null,
    net: {
      before: num(raw.net_income?.before),
      after: num(raw.net_income?.after),
      change: num(raw.net_income?.change),
    },
    included: measures.included ?? [],
    notAffected: measures.not_affected ?? [],
    notModelled: (measures.not_modelled ?? []).map((item) =>
      typeof item === "string" ? { id: item, reason: "" } : { id: item.id, reason: item.reason ?? "" },
    ),
    programmes: Array.isArray(raw.programmes) ? raw.programmes.map(normaliseProgramme) : null,
    byPolicy: Array.isArray(raw.by_policy)
      ? raw.by_policy.map((row) => ({ id: String(row.id), change: num(row.change) }))
      : null,
    sweep:
      sweep && Array.isArray(sweep.income) && sweep.income.length > 1
        ? {
            income: sweep.income.map(num),
            before: sweep.before.map(num),
            after: sweep.after.map(num),
            min: num(sweep.min ?? sweep.income[0]),
            max: num(sweep.max ?? sweep.income[sweep.income.length - 1]),
          }
        : null,
    versions: raw.versions ?? {},
  };
}

/** A later stage's parts added to the first stage's result. */
export function mergeStages(first, detail) {
  return {
    ...first,
    byPolicy: detail.byPolicy ?? first.byPolicy,
    sweep: detail.sweep ?? first.sweep,
    programmes: first.programmes ?? detail.programmes,
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

/**
 * Build-time check of the Personal impact tab's two API URLs, run by
 * next.config.ts:
 *
 * - NEXT_PUBLIC_LIFECYCLE_API_URL (Multi-year effect). The tab POSTs to
 *   `${NEXT_PUBLIC_LIFECYCLE_API_URL}/calculate`, and the API serves
 *   `/api/lifecycle/calculate`, so the variable must be the service URL
 *   followed by `/api/lifecycle`, with no trailing slash.
 * - NEXT_PUBLIC_HOUSEHOLD_API_URL (Single-year effect). The tab POSTs to
 *   the value itself, and the API serves `/api/household-impact`, so the
 *   variable must be the service URL followed by `/api/household-impact`,
 *   with no trailing slash.
 *
 * Each value is baked into the bundle at build time: a wrong or missing one
 * gives a broken sub-tab that only a rebuild can fix, so the build says so.
 *
 * - A value set in the wrong form fails every build: it can never work.
 * - A missing value fails a Vercel production build (VERCEL_ENV=production),
 *   except a drill build (NEXT_PUBLIC_MOCK set), whose production target is
 *   a mock. Elsewhere (previews, CI, local builds) it is a loud warning, and
 *   the sub-tab shows that the variable is not set.
 */

export const LIFECYCLE_API_VAR = "NEXT_PUBLIC_LIFECYCLE_API_URL";
export const LIFECYCLE_API_SUFFIX = "/api/lifecycle";
export const LIFECYCLE_API_EXAMPLE =
  "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/lifecycle";

export const HOUSEHOLD_API_VAR = "NEXT_PUBLIC_HOUSEHOLD_API_URL";
export const HOUSEHOLD_API_SUFFIX = "/api/household-impact";
export const HOUSEHOLD_API_EXAMPLE =
  "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact";

/** The two variables, what each must end in, and what the page adds. */
export const API_URL_SPECS = [
  {
    variable: LIFECYCLE_API_VAR,
    suffix: LIFECYCLE_API_SUFFIX,
    example: LIFECYCLE_API_EXAMPLE,
    view: "Multi-year effect",
    appends: "/calculate",
  },
  {
    variable: HOUSEHOLD_API_VAR,
    suffix: HOUSEHOLD_API_SUFFIX,
    example: HOUSEHOLD_API_EXAMPLE,
    view: "Single-year effect",
    appends: null,
  },
];

/**
 * What is wrong with one API URL in `env`, if anything.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(typeof API_URL_SPECS)[number]} spec
 * @returns {{ level: "error" | "warning", message: string } | null}
 */
export function apiUrlProblem(env, spec) {
  const { variable, suffix, example, view, appends } = spec;
  const url = (env[variable] ?? "").trim();
  if (url) {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      // reported below
    }
    const wellFormed =
      parsed !== null &&
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.search &&
      !parsed.hash &&
      url.endsWith(suffix);
    if (wellFormed) return null;
    return {
      level: "error",
      message:
        `${variable} must be the API's URL followed by ${suffix}, with no ` +
        `trailing slash${appends ? ` (the page appends ${appends})` : ""}, ` +
        `for example ${example}.`,
    };
  }
  const production = env.VERCEL_ENV === "production";
  const drill = Boolean(env.NEXT_PUBLIC_MOCK);
  return {
    level: production && !drill ? "error" : "warning",
    message:
      `${variable} is not set, so the Personal impact tab's ${view} cannot ` +
      `calculate. Set it to the API's URL followed by ${suffix}, ` +
      `for example ${example}, and rebuild.`,
  };
}

/** What is wrong with the lifecycle API URL in `env`, if anything. */
export function lifecycleApiUrlProblem(env) {
  return apiUrlProblem(env, API_URL_SPECS[0]);
}

/** What is wrong with the household API URL in `env`, if anything. */
export function householdApiUrlProblem(env) {
  return apiUrlProblem(env, API_URL_SPECS[1]);
}

function report(problem, log) {
  if (!problem) return;
  if (problem.level === "error") throw new Error(problem.message);
  log.warn(`\n⚠ Warning: ${problem.message}\n`);
}

/**
 * Throw on an error, print a warning otherwise.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ warn: (message: string) => void }} [log]
 */
export function checkLifecycleApiEnv(env, log = console) {
  report(lifecycleApiUrlProblem(env), log);
}

/** As checkLifecycleApiEnv, for the household API URL. */
export function checkHouseholdApiEnv(env, log = console) {
  report(householdApiUrlProblem(env), log);
}

/** Both of the Personal impact tab's API URLs: what next.config.ts runs. */
export function checkPersonalApiEnv(env, log = console) {
  checkLifecycleApiEnv(env, log);
  checkHouseholdApiEnv(env, log);
}

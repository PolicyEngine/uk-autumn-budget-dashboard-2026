/**
 * Build-time check of the Personal impact tab's API URL, run by
 * next.config.ts.
 *
 * NEXT_PUBLIC_HOUSEHOLD_API_URL: the tab POSTs to the value itself, and the
 * API serves `/api/household-impact`, so the variable must be the service
 * URL followed by `/api/household-impact`, with no trailing slash.
 *
 * The value is baked into the bundle at build time: a wrong or missing one
 * gives a broken tab that only a rebuild can fix, so the build says so.
 *
 * - A value set in the wrong form fails every build: it can never work.
 * - A missing value fails a Vercel production build (VERCEL_ENV=production),
 *   except a drill build (NEXT_PUBLIC_MOCK set), whose production target is
 *   a mock. Elsewhere (previews, CI, local builds) it is a loud warning, and
 *   the tab shows that the variable is not set.
 */

export const HOUSEHOLD_API_VAR = "NEXT_PUBLIC_HOUSEHOLD_API_URL";
export const HOUSEHOLD_API_SUFFIX = "/api/household-impact";
export const HOUSEHOLD_API_EXAMPLE =
  "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact";

/**
 * What is wrong with the household API URL in `env`, if anything.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ level: "error" | "warning", message: string } | null}
 */
export function householdApiUrlProblem(env) {
  const variable = HOUSEHOLD_API_VAR;
  const suffix = HOUSEHOLD_API_SUFFIX;
  const example = HOUSEHOLD_API_EXAMPLE;
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
        `trailing slash, for example ${example}.`,
    };
  }
  const production = env.VERCEL_ENV === "production";
  const drill = Boolean(env.NEXT_PUBLIC_MOCK);
  return {
    level: production && !drill ? "error" : "warning",
    message:
      `${variable} is not set, so the Personal impact tab cannot ` +
      `calculate. Set it to the API's URL followed by ${suffix}, ` +
      `for example ${example}, and rebuild.`,
  };
}

/**
 * Throw on an error, print a warning otherwise: what next.config.ts runs.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ warn: (message: string) => void }} [log]
 */
export function checkHouseholdApiEnv(env, log = console) {
  const problem = householdApiUrlProblem(env);
  if (!problem) return;
  if (problem.level === "error") throw new Error(problem.message);
  log.warn(`\n⚠ Warning: ${problem.message}\n`);
}

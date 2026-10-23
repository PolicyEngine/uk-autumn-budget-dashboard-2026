/**
 * Build-time check of NEXT_PUBLIC_LIFECYCLE_API_URL, run by next.config.ts.
 *
 * The Personal impact tab POSTs to `${NEXT_PUBLIC_LIFECYCLE_API_URL}/calculate`,
 * and the API serves `/api/lifecycle/calculate`, so the variable must be the
 * service URL followed by `/api/lifecycle`, with no trailing slash. The value
 * is baked into the bundle at build time: a wrong or missing one gives a
 * broken tab that only a rebuild can fix, so the build says so.
 *
 * - A value set in the wrong form fails every build: it can never work.
 * - A missing value fails a Vercel production build (VERCEL_ENV=production),
 *   except a drill build (NEXT_PUBLIC_MOCK set), whose production target is
 *   a mock. Elsewhere (previews, CI, local builds) it is a loud warning, and
 *   the tab shows that the variable is not set.
 */

export const LIFECYCLE_API_VAR = "NEXT_PUBLIC_LIFECYCLE_API_URL";
export const LIFECYCLE_API_SUFFIX = "/api/lifecycle";
export const LIFECYCLE_API_EXAMPLE =
  "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/lifecycle";

/**
 * What is wrong with the lifecycle API URL in `env`, if anything.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ level: "error" | "warning", message: string } | null}
 */
export function lifecycleApiUrlProblem(env) {
  const url = (env[LIFECYCLE_API_VAR] ?? "").trim();
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
      url.endsWith(LIFECYCLE_API_SUFFIX);
    if (wellFormed) return null;
    return {
      level: "error",
      message:
        `${LIFECYCLE_API_VAR} must be the API's URL followed by ` +
        `${LIFECYCLE_API_SUFFIX}, with no trailing slash (the page appends ` +
        `/calculate), for example ${LIFECYCLE_API_EXAMPLE}.`,
    };
  }
  const production = env.VERCEL_ENV === "production";
  const drill = Boolean(env.NEXT_PUBLIC_MOCK);
  return {
    level: production && !drill ? "error" : "warning",
    message:
      `${LIFECYCLE_API_VAR} is not set, so the Personal impact tab cannot ` +
      `calculate. Set it to the API's URL followed by ${LIFECYCLE_API_SUFFIX}, ` +
      `for example ${LIFECYCLE_API_EXAMPLE}, and rebuild.`,
  };
}

/**
 * Throw on an error, print a warning otherwise.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ warn: (message: string) => void }} [log]
 */
export function checkLifecycleApiEnv(env, log = console) {
  const problem = lifecycleApiUrlProblem(env);
  if (!problem) return;
  if (problem.level === "error") throw new Error(problem.message);
  log.warn(`\n⚠ Warning: ${problem.message}\n`);
}

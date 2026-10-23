import { describe, expect, it, vi } from "vitest";
import {
  checkLifecycleApiEnv,
  lifecycleApiUrlProblem,
} from "../../scripts/lifecycle-api-env.mjs";

const GOOD = "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/lifecycle";

describe("lifecycleApiUrlProblem", () => {
  it("accepts the service URL followed by /api/lifecycle", () => {
    for (const env of [
      { NEXT_PUBLIC_LIFECYCLE_API_URL: GOOD, VERCEL_ENV: "production" },
      { NEXT_PUBLIC_LIFECYCLE_API_URL: "http://localhost:5001/api/lifecycle" },
    ]) {
      expect(lifecycleApiUrlProblem(env)).toBeNull();
    }
  });

  it("refuses any other form in every build", () => {
    for (const url of [
      "http://localhost:5001", // the old .env.example: /calculate gives 404
      "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app",
      `${GOOD}/`,
      `${GOOD}/calculate`,
      `${GOOD}?x=1`,
      "uk-budget-api-2026/api/lifecycle",
    ]) {
      for (const extra of [{}, { VERCEL_ENV: "preview" }, { NEXT_PUBLIC_MOCK: "1" }]) {
        const problem = lifecycleApiUrlProblem({
          NEXT_PUBLIC_LIFECYCLE_API_URL: url,
          ...extra,
        });
        expect(problem?.level, url).toBe("error");
        expect(problem.message).toContain("/api/lifecycle");
      }
    }
  });

  it("fails a production build without it", () => {
    expect(lifecycleApiUrlProblem({ VERCEL_ENV: "production" })?.level).toBe("error");
    expect(
      lifecycleApiUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_LIFECYCLE_API_URL: " " })
        ?.level,
    ).toBe("error");
  });

  it("only warns on preview, drill, CI and local builds without it", () => {
    for (const env of [
      {},
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "development" },
      { VERCEL_ENV: "production", NEXT_PUBLIC_MOCK: "1" },
      { CI: "true" },
    ]) {
      expect(lifecycleApiUrlProblem(env)?.level).toBe("warning");
    }
  });
});

describe("checkLifecycleApiEnv", () => {
  it("throws on an error and warns otherwise", () => {
    const log = { warn: vi.fn() };
    expect(() => checkLifecycleApiEnv({ VERCEL_ENV: "production" }, log)).toThrow(
      /NEXT_PUBLIC_LIFECYCLE_API_URL is not set/,
    );
    checkLifecycleApiEnv({ VERCEL_ENV: "preview" }, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    checkLifecycleApiEnv({ NEXT_PUBLIC_LIFECYCLE_API_URL: GOOD }, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

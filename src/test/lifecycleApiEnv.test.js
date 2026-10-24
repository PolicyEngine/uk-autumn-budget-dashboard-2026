import { describe, expect, it, vi } from "vitest";
import {
  checkLifecycleApiEnv,
  checkPersonalApiEnv,
  householdApiUrlProblem,
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

const HOUSEHOLD =
  "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact";

describe("householdApiUrlProblem", () => {
  it("accepts the service URL followed by /api/household-impact", () => {
    for (const env of [
      { NEXT_PUBLIC_HOUSEHOLD_API_URL: HOUSEHOLD, VERCEL_ENV: "production" },
      { NEXT_PUBLIC_HOUSEHOLD_API_URL: "http://localhost:5001/api/household-impact" },
    ]) {
      expect(householdApiUrlProblem(env)).toBeNull();
    }
  });

  it("refuses any other form in every build", () => {
    for (const url of [
      "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app",
      GOOD, // the lifecycle URL
      `${HOUSEHOLD}/`,
      `${HOUSEHOLD}?x=1`,
    ]) {
      for (const extra of [{}, { VERCEL_ENV: "preview" }, { NEXT_PUBLIC_MOCK: "1" }]) {
        const problem = householdApiUrlProblem({ NEXT_PUBLIC_HOUSEHOLD_API_URL: url, ...extra });
        expect(problem?.level, url).toBe("error");
        expect(problem.message).toContain("/api/household-impact");
      }
    }
  });

  it("fails a production build without it, and only warns elsewhere", () => {
    expect(householdApiUrlProblem({ VERCEL_ENV: "production" })?.level).toBe("error");
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production", NEXT_PUBLIC_MOCK: "1" }]) {
      expect(householdApiUrlProblem(env)?.level).toBe("warning");
    }
  });
});

describe("checkPersonalApiEnv", () => {
  it("checks both URLs: a production build needs each", () => {
    const log = { warn: vi.fn() };
    expect(() =>
      checkPersonalApiEnv({ VERCEL_ENV: "production", NEXT_PUBLIC_LIFECYCLE_API_URL: GOOD }, log),
    ).toThrow(/NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/);
    expect(() =>
      checkPersonalApiEnv({ VERCEL_ENV: "production", NEXT_PUBLIC_HOUSEHOLD_API_URL: HOUSEHOLD }, log),
    ).toThrow(/NEXT_PUBLIC_LIFECYCLE_API_URL is not set/);
    checkPersonalApiEnv(
      {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_LIFECYCLE_API_URL: GOOD,
        NEXT_PUBLIC_HOUSEHOLD_API_URL: HOUSEHOLD,
      },
      log,
    );
    expect(log.warn).not.toHaveBeenCalled();
    checkPersonalApiEnv({ VERCEL_ENV: "preview" }, log);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

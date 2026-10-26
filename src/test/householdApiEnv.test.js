import { describe, expect, it, vi } from "vitest";
import { checkHouseholdApiEnv, householdApiUrlProblem } from "../../scripts/household-api-env.mjs";

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
      "https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/personal-impact",
      `${HOUSEHOLD}/`,
      `${HOUSEHOLD}?x=1`,
      "uk-budget-api-2026/api/household-impact",
    ]) {
      for (const extra of [{}, { VERCEL_ENV: "preview" }, { NEXT_PUBLIC_MOCK: "1" }]) {
        const problem = householdApiUrlProblem({ NEXT_PUBLIC_HOUSEHOLD_API_URL: url, ...extra });
        expect(problem?.level, url).toBe("error");
        expect(problem.message).toContain("/api/household-impact");
      }
    }
  });

  it("fails a production build without it", () => {
    expect(householdApiUrlProblem({ VERCEL_ENV: "production" })?.level).toBe("error");
    expect(
      householdApiUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_HOUSEHOLD_API_URL: " " })?.level,
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
      expect(householdApiUrlProblem(env)?.level).toBe("warning");
    }
  });
});

describe("checkHouseholdApiEnv", () => {
  it("throws on an error and warns otherwise", () => {
    const log = { warn: vi.fn() };
    expect(() => checkHouseholdApiEnv({ VERCEL_ENV: "production" }, log)).toThrow(
      /NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/,
    );
    checkHouseholdApiEnv({ VERCEL_ENV: "preview" }, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    checkHouseholdApiEnv({ NEXT_PUBLIC_HOUSEHOLD_API_URL: HOUSEHOLD }, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("ignores the retired lifecycle URL", () => {
    const log = { warn: vi.fn() };
    expect(() =>
      checkHouseholdApiEnv(
        {
          VERCEL_ENV: "production",
          NEXT_PUBLIC_LIFECYCLE_API_URL: "https://example.test/api/lifecycle",
        },
        log,
      ),
    ).toThrow(/NEXT_PUBLIC_HOUSEHOLD_API_URL is not set/);
  });
});

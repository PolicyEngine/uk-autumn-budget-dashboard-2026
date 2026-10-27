// A cold calculator (27 October 2026, Modal test app): the first request
// after a quiet spell came back empty after about 150 s. The page asks again
// while the service looks to be starting up, and never for an answer a
// retry would not change.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HouseholdApiError,
  MODAL_TIMEOUT_MS,
  RETRY_POLICY,
  isStartingUp,
  postHouseholdDetail,
  postHouseholdImpactRetrying,
} from "./householdImpactApi";
import { householdAnswerFor } from "../test/householdFixture";

const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const BODY = { year: 2029, policies: [], household: {}, include: [] };
// Tests wait milliseconds, not the real 5 s
const FAST = { delayMs: 1, maxRetryAfterMs: 60, minAttemptMs: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ok = () => Response.json(householdAnswerFor(BODY));
const empty = (status = 200) => new Response("", { status });

/** A fetch that answers in turn from `answers` (functions of init), recording each URL. */
function scripted(answers, calls = []) {
  let i = 0;
  return Object.assign(
    async (url, init) => {
      calls.push(url);
      const answer = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return answer(init);
    },
    { calls },
  );
}

/** Never answers; rejects when aborted, as fetch does. */
const hang = (init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

describe("isStartingUp", () => {
  it("is true for a timeout, no connection, an empty answer and a 502, 503 or 504", () => {
    expect(isStartingUp(new HouseholdApiError("timeout", "slow"))).toBe(true);
    expect(isStartingUp(new HouseholdApiError("network", "down"))).toBe(true);
    expect(isStartingUp(new HouseholdApiError("server", "empty", { status: 200, empty: true }))).toBe(true);
    expect(isStartingUp(new HouseholdApiError("server", "bad gateway", { status: 502 }))).toBe(true);
    expect(isStartingUp(new HouseholdApiError("server", "unavailable", { status: 503 }))).toBe(true);
    expect(isStartingUp(new HouseholdApiError("server", "no body", { status: 500, empty: true }))).toBe(true);
  });

  it("is false for what asking again would not change", () => {
    expect(isStartingUp(new HouseholdApiError("invalid", "bad answer", { status: 422 }))).toBe(false);
    expect(isStartingUp(new HouseholdApiError("server", "no app", { status: 404 }))).toBe(false);
    expect(isStartingUp(new HouseholdApiError("server", "Calculation error: boom", { status: 500 }))).toBe(false);
    expect(isStartingUp(new HouseholdApiError("config", "no URL"))).toBe(false);
    expect(isStartingUp(new Error("EngineMismatchError"))).toBe(false);
    expect(isStartingUp(null)).toBe(false);
  });
});

describe("postHouseholdImpactRetrying", () => {
  it("asks again after an empty answer, and returns the next one", async () => {
    const fetchImpl = scripted([() => empty(), ok]);
    const onRetry = vi.fn();
    const raw = await postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl, retry: FAST, onRetry });
    expect(raw.net_income).toBeTruthy();
    expect(fetchImpl.calls).toEqual([MAIN, MAIN]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ kind: "server", empty: true });
  });

  it("asks again after a 504, a 502 with no body and a client timeout", async () => {
    for (const first of [() => Response.json({ detail: "timed out" }, { status: 504 }), () => empty(502), hang]) {
      const fetchImpl = scripted([first, ok]);
      const raw = await postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl, retry: FAST, timeoutMs: 30 });
      expect(raw.net_income).toBeTruthy();
      expect(fetchImpl.calls).toHaveLength(2);
    }
  });

  it("waits for the service's Retry-After, capped", async () => {
    const fetchImpl = scripted([
      () => Response.json({ detail: "starting" }, { status: 503, headers: { "Retry-After": "0.04" } }),
      ok,
    ]);
    const started = Date.now();
    await postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl, retry: FAST });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);

    // From the body when the header is not exposed to the page; capped at
    // maxRetryAfterMs (60 ms here), not the 600 s asked for
    const capped = scripted([() => Response.json({ retry_after_seconds: 600 }, { status: 503 }), ok]);
    const t0 = Date.now();
    await postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl: capped, retry: FAST });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(capped.calls).toHaveLength(2);
  });

  it("does not ask again after an answer the API refused, or a missing service", async () => {
    for (const status of [400, 404, 422]) {
      const fetchImpl = scripted([() => Response.json({ detail: "no" }, { status }), ok]);
      await expect(postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl, retry: FAST })).rejects.toBeInstanceOf(HouseholdApiError);
      expect(fetchImpl.calls).toHaveLength(1);
    }
  });

  it("gives up after its retries, with the last error", async () => {
    const fetchImpl = scripted([() => empty(503)]);
    const error = await postHouseholdImpactRetrying(BODY, { url: MAIN, fetchImpl, retry: { ...FAST, maxRetries: 2 } }).catch((e) => e);
    expect(error).toMatchObject({ kind: "server", status: 503 });
    expect(isStartingUp(error)).toBe(true);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("gives up when too little of the time budget is left for another attempt", async () => {
    const fetchImpl = scripted([() => empty(503)]);
    const error = await postHouseholdImpactRetrying(BODY, {
      url: MAIN,
      fetchImpl,
      retry: { delayMs: 50, maxRetryAfterMs: 50, budgetMs: 80, minAttemptMs: 40, maxRetries: 5 },
    }).catch((e) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("stops at once when the page aborts during the wait", async () => {
    const fetchImpl = scripted([() => empty(503), ok]);
    const controller = new AbortController();
    const asked = postHouseholdImpactRetrying(BODY, {
      url: MAIN,
      fetchImpl,
      signal: controller.signal,
      retry: { ...FAST, delayMs: 5_000, maxRetryAfterMs: 5_000 },
      onRetry: () => controller.abort(),
    });
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("keeps the real policy's numbers: 5 s, three retries, 150 s in all", () => {
    expect(RETRY_POLICY).toMatchObject({ delayMs: 5_000, maxRetries: 3, budgetMs: 150_000 });
    // The page stops waiting for Modal before its 150 s web limit
    expect(MODAL_TIMEOUT_MS).toBeLessThan(150_000);
  });
});

describe("postHouseholdDetail while the detail service starts up", () => {
  it("goes to the main API at once after an empty detail answer, without asking the detail service again", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      calls.push(url === DETAIL ? "detail" : "main");
      return url === DETAIL ? empty() : ok();
    });
    const raw = await postHouseholdDetail(BODY, { retry: FAST });
    expect(raw.net_income).toBeTruthy();
    expect(calls).toEqual(["detail", "main"]);
  });

  it("asks the main API again when it, too, is starting up", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
    const calls = [];
    let mainAsked = 0;
    vi.stubGlobal("fetch", async (url) => {
      calls.push(url === DETAIL ? "detail" : "main");
      if (url === DETAIL) return empty(503);
      mainAsked += 1;
      return mainAsked === 1 ? empty(503) : ok();
    });
    const onRetry = vi.fn();
    await postHouseholdDetail(BODY, { retry: FAST, onRetry });
    expect(calls).toEqual(["detail", "main", "main"]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry the main API unless asked to (the example cards' background fill)", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    const calls = [];
    vi.stubGlobal("fetch", async () => {
      calls.push("main");
      return empty(503);
    });
    await expect(postHouseholdDetail(BODY)).rejects.toMatchObject({ status: 503 });
    expect(calls).toEqual(["main"]);
  });
});

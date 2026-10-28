// The calculator after a quiet spell (27 October 2026, Modal test app): the
// first request came back empty after about 150 s, and the page showed
// nothing. The hook now says the calculator is starting up, asks again, and
// still shows only an answer from the published model versions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache, setHouseholdRetryPolicy } from "./useHouseholdImpact";
import { EngineMismatchError, isStartingUp } from "../utils/householdImpactApi";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const BUILD = "c".repeat(40);
const ENGINE = {
  policyengine: HOUSEHOLD_FIXTURE.engine.policyengine,
  "policyengine-uk": HOUSEHOLD_FIXTURE.engine["policyengine-uk"],
  "policyengine-core": HOUSEHOLD_FIXTURE.engine["policyengine-core"],
};
const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "snapshot-one", expectedEngine: ENGINE };
const partOf = (body) => (body.include.length === 0 ? "headline" : body.include[0]);
const answer = (body, extra = {}) =>
  Response.json({ ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine, git_sha: BUILD, ...extra });

beforeEach(() => {
  clearHouseholdImpactCache();
  // Milliseconds between retries, not the real 5 s; a wait long enough to
  // see the starting-up state before the retry answers
  setHouseholdRetryPolicy({ delayMs: 60, maxRetryAfterMs: 60, minAttemptMs: 1 });
});
afterEach(() => {
  cleanup();
  clearHouseholdImpactCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** One service, answering each request through `respond(body, n)`; n counts headline asks. */
function oneService(calls, respond) {
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
  let headlines = 0;
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(partOf(body));
    if (partOf(body) === "headline") headlines += 1;
    return respond(body, headlines);
  });
}

describe("a cold calculator", () => {
  it("says it is starting up after an empty answer, asks again and shows the result", async () => {
    const calls = [];
    oneService(calls, (body, n) => (partOf(body) === "headline" && n === 1 ? new Response("", { status: 200 }) : answer(body)));
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.startingUp).toBe(true));
    expect(hook.result.current.status).toBe("loading");
    expect(hook.result.current.error).toBeNull();
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.startingUp).toBe(false);
    expect(hook.result.current.data.net.change).toBe(HOUSEHOLD_FIXTURE.net_income.change);
    expect(calls.filter((part) => part === "headline")).toHaveLength(2);
  });

  it("asks again after a 504", async () => {
    const calls = [];
    oneService(calls, (body, n) =>
      partOf(body) === "headline" && n === 1 ? Response.json({ detail: "Calculation timed out" }, { status: 504 }) : answer(body),
    );
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.status).toBe("ready");
    expect(calls.filter((part) => part === "headline")).toHaveLength(2);
  });

  it("ends in a starting-up error the reader can retry when the service never answers", async () => {
    setHouseholdRetryPolicy({ delayMs: 1, maxRetryAfterMs: 1, minAttemptMs: 1, maxRetries: 2 });
    const calls = [];
    oneService(calls, () => new Response("", { status: 503 }));
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(isStartingUp(hook.result.current.error)).toBe(true);
    expect(hook.result.current.startingUp).toBe(false);
    expect(hook.result.current.data).toBeNull();
    // The first ask and two retries, then nothing more
    expect(calls).toEqual(["headline", "headline", "headline"]);
  });

  it("never shows a retried answer from other model versions than the published figures", async () => {
    const calls = [];
    oneService(calls, (body, n) =>
      partOf(body) === "headline" && n === 1
        ? new Response("", { status: 502 })
        : answer(body, { engine: { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "0.0.1" } }),
    );
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
    expect(hook.result.current.data).toBeNull();
  });

  it("does not ask again after an answer the API refused", async () => {
    const calls = [];
    oneService(calls, () => Response.json({ detail: "Unknown measure" }, { status: 400 }));
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(calls).toEqual(["headline"]);
  });
});

describe("a cold detail service (Modal) beside a warm main API", () => {
  it("takes the breakdown from the main API when the detail service answers empty, with the same build checks", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
    const calls = [];
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(`${url === DETAIL ? "detail" : "main"}:${partOf(body)}`);
      return url === DETAIL ? new Response("", { status: 200 }) : answer(body);
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.data.byPolicy).not.toBeNull();
    expect(hook.result.current.data.sweep).not.toBeNull();
    // Each part asked of the detail service once (early, beside the
    // headline), then of the main API: never the detail service twice
    expect(calls.filter((call) => call.startsWith("detail:")).sort()).toEqual(["detail:by_policy", "detail:sweep"]);
    expect(calls.filter((call) => call.startsWith("main:")).sort()).toEqual(["main:by_policy", "main:headline", "main:sweep"]);
  });

  it("says the breakdown is starting up while the main API is asked again, then shows it", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
    const asked = {};
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      const id = `${url === DETAIL ? "detail" : "main"}:${partOf(body)}`;
      asked[id] = (asked[id] ?? 0) + 1;
      if (url === DETAIL) return new Response("", { status: 503 });
      if (partOf(body) === "sweep" && asked[id] === 1) return new Response("", { status: 503 });
      return answer(body);
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStartingUp).toBe(true));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.detailStartingUp).toBe(false);
    expect(hook.result.current.data.sweep).not.toBeNull();
    expect(asked["main:sweep"]).toBe(2);
    expect(asked["detail:sweep"]).toBe(1);
  });

  it("refuses a breakdown from another build even after the main API is asked again", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === DETAIL) return new Response("", { status: 503 });
      // The headline from BUILD; the main API's breakdown, once it answers,
      // from another commit (a deploy mid-way)
      return partOf(body) === "headline" ? answer(body) : answer(body, { git_sha: "d".repeat(40) });
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
    expect(hook.result.current.data).toBeNull();
  });
});

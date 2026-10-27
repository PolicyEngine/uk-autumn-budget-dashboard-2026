import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
import { EngineMismatchError } from "../utils/householdImpactApi";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

// A short Modal headline timeout, so "slow" is quick to test (25 s live)
vi.mock("../utils/householdImpactApi", async (importOriginal) => ({
  ...(await importOriginal()),
  MODAL_HEADLINE_TIMEOUT_MS: 150,
}));

const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const MAIN_VERSION = "https://main.test/api/version";
const DETAIL_VERSION = "https://detail.test/api/version";
const BUILD = "c".repeat(40);
const OTHER = "d".repeat(40);
const ENGINE = {
  policyengine: HOUSEHOLD_FIXTURE.engine.policyengine,
  "policyengine-uk": HOUSEHOLD_FIXTURE.engine["policyengine-uk"],
  "policyengine-core": HOUSEHOLD_FIXTURE.engine["policyengine-core"],
};
const params = {
  inputs: WIZARD_DEFAULTS,
  year: 2029,
  policies: HOUSEHOLD_FIXTURE.included,
  enabled: true,
  publicationKey: "snapshot-one",
  expectedEngine: ENGINE,
};

const partOf = (body) => (body.include.length === 0 ? "headline" : body.include[0]);
const identity = (git_sha, packages = HOUSEHOLD_FIXTURE.engine) => ({ service: "test", git_sha, packages });
const answer = (body, extra = {}) => ({
  ...structuredClone(householdAnswerFor(body)),
  engine: HOUSEHOLD_FIXTURE.engine,
  git_sha: BUILD,
  ...extra,
});

/**
 * Both services, each answering as told. `calls` gets one entry a request:
 * "main:version", "detail:headline", and so on.
 */
function serve(calls, {
  mainVersion = () => identity(BUILD),
  detailVersion = () => identity(BUILD),
  main = (body) => answer(body),
  detail = (body) => answer(body),
} = {}) {
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
  vi.stubGlobal("fetch", async (url, init = {}) => {
    if (url === MAIN_VERSION || url === DETAIL_VERSION) {
      const side = url === MAIN_VERSION ? "main" : "detail";
      calls.push(`${side}:version`);
      return Response.json((side === "main" ? mainVersion : detailVersion)());
    }
    const side = url === DETAIL ? "detail" : "main";
    const body = JSON.parse(init.body);
    calls.push(`${side}:${partOf(body)}`);
    const reply = await (side === "detail" ? detail : main)(body, init);
    return reply instanceof Response ? reply : Response.json(reply);
  });
}

/** Never answers until the request is stopped (a slow service). */
const never = (_body, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

const posts = (calls) => calls.filter((call) => !call.endsWith(":version"));

beforeEach(clearHouseholdImpactCache);
afterEach(() => {
  cleanup();
  clearHouseholdImpactCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the headline from the detail service (Modal)", () => {
  it("asks Modal for the headline, the sweep and the split at once, and Cloud Run for nothing, when both report one build", async () => {
    const calls = [];
    serve(calls);
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.data.build).toBe(BUILD);
    expect(hook.result.current.data.sweep).not.toBeNull();
    expect(hook.result.current.data.byPolicy).not.toBeNull();
    expect(posts(calls).sort()).toEqual(["detail:by_policy", "detail:headline", "detail:sweep"]);
    expect(calls.filter((call) => call.endsWith(":version")).sort()).toEqual(["detail:version", "main:version"]);
  });

  it("checks the two builds once, not before every calculation", async () => {
    const calls = [];
    serve(calls);
    const first = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(first.result.current.detailStatus).toBe("ready"));
    first.unmount();
    const second = renderHook(() => useHouseholdImpact({ ...params, year: 2030 }));
    await waitFor(() => expect(second.result.current.detailStatus).toBe("ready"));
    expect(calls.filter((call) => call.endsWith(":version"))).toHaveLength(2);
    expect(posts(calls).filter((call) => call.startsWith("main:"))).toEqual([]);
  });

  for (const [why, versions] of [
    ["Cloud Run reports no build commit", { mainVersion: () => identity(null) }],
    ["the two report different commits", { detailVersion: () => identity(OTHER) }],
    ["the two run other model packages", { detailVersion: () => identity(BUILD, { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" }) }],
    ["Modal's identity can't be read", { detailVersion: () => { throw new Error("down"); } }],
  ]) {
    it(`asks Cloud Run for the headline, and never Modal, when ${why}`, async () => {
      const calls = [];
      serve(calls, versions);
      const hook = renderHook(() => useHouseholdImpact(params));
      await waitFor(() => expect(hook.result.current.detailStatus).not.toBe("loading"));
      expect(hook.result.current.status).toBe("ready");
      expect(posts(calls)).toContain("main:headline");
      expect(posts(calls)).not.toContain("detail:headline");
    });
  }

  for (const [why, detail] of [
    ["is down (the request fails)", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["answers with an error", (body) => (partOf(body) === "headline" ? Response.json({ detail: "boom" }, { status: 503 }) : answer(body))],
    ["is slower than the headline's timeout", (body, init) => (partOf(body) === "headline" ? never(body, init) : answer(body))],
    ["answers from another build (a deploy's change-over)", (body) => answer(body, { git_sha: OTHER })],
    ["answers from other model packages than the published figures", (body) => answer(body, { engine: { ...HOUSEHOLD_FIXTURE.engine, policyengine: "0.0.1" } })],
  ]) {
    it(`falls back to Cloud Run for the whole answer when Modal ${why}`, async () => {
      const calls = [];
      serve(calls, { detail });
      const hook = renderHook(() => useHouseholdImpact(params));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
      expect(hook.result.current.status).toBe("ready");
      expect(hook.result.current.error).toBeNull();
      const main = posts(calls).filter((call) => call.startsWith("main:")).sort();
      expect(main).toEqual(["main:by_policy", "main:headline", "main:sweep"]);
      // Modal was asked once for each part, with its headline, and not again
      expect(posts(calls).filter((call) => call.startsWith("detail:")).sort()).toEqual([
        "detail:by_policy",
        "detail:headline",
        "detail:sweep",
      ]);
    });
  }

  it("asks Cloud Run alone for the next calculation after a Modal headline failed", async () => {
    const calls = [];
    serve(calls, { detail: () => Response.json({ detail: "boom" }, { status: 503 }) });
    const first = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(first.result.current.detailStatus).toBe("ready"));
    first.unmount();
    calls.length = 0;
    const second = renderHook(() => useHouseholdImpact({ ...params, year: 2030 }));
    await waitFor(() => expect(second.result.current.detailStatus).not.toBe("loading"));
    expect(second.result.current.status).toBe("ready");
    expect(posts(calls)).toContain("main:headline");
    expect(posts(calls)).not.toContain("detail:headline");
    expect(calls.filter((call) => call.endsWith(":version"))).toEqual([]);
  });

  it("still refuses when Cloud Run's fallback answer is from other packages than the published figures", async () => {
    const calls = [];
    const stale = { ...HOUSEHOLD_FIXTURE.engine, policyengine: "0.0.1" };
    serve(calls, {
      detail: (body) => answer(body, { engine: stale }),
      main: (body) => answer(body, { engine: stale }),
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
    expect(hook.result.current.data).toBeNull();
  });

  it("asks Cloud Run for a part Modal fails, under Modal's headline", async () => {
    const calls = [];
    serve(calls, {
      detail: (body) => (partOf(body) === "by_policy" ? Response.json({ detail: "boom" }, { status: 500 }) : answer(body)),
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.data.byPolicy).not.toBeNull();
    expect(posts(calls).sort()).toEqual(["detail:by_policy", "detail:headline", "detail:sweep", "main:by_policy"]);
  });
});

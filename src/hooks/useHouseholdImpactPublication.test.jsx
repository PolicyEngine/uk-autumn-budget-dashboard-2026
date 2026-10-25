import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
import { EngineMismatchError } from "../utils/householdImpactApi";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

beforeEach(clearHouseholdImpactCache);
afterEach(() => {
  cleanup();
  clearHouseholdImpactCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("fetches a fresh answer for the same household after the publication snapshot changes", async () => {
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
  const requests = [];
  let change = HOUSEHOLD_FIXTURE.net_income.change;
  vi.stubGlobal("fetch", async (url, init) => {
    expect(url).toBe("https://api.test/api/household-impact");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    requests.push(body);
    const answer = structuredClone(householdAnswerFor(body));
    answer.net_income.change = change;
    answer.net_income.reform = answer.net_income.baseline + change;
    return Response.json(answer);
  });
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true };
  const first = renderHook(() => useHouseholdImpact({ ...params, publicationKey: "snapshot-one" }));
  await waitFor(() => expect(first.result.current.detailStatus).toBe("ready"));
  expect(first.result.current.data.net.change).toBe(change);
  // The headline, then the sweep and the split by policy
  expect(requests).toHaveLength(3);
  first.unmount();

  change += 111;
  const second = renderHook(() => useHouseholdImpact({ ...params, publicationKey: "snapshot-two" }));
  expect(second.result.current.data).toBeNull();
  await waitFor(() => expect(second.result.current.detailStatus).toBe("ready"));
  expect(requests).toHaveLength(6);
  expect(requests.slice(3)).toEqual(requests.slice(0, 3));
  expect(second.result.current.data.net.change).toBe(change);
  second.unmount();

  // Reopening the same snapshot still benefits from its completed cache.
  const reopened = renderHook(() => useHouseholdImpact({ ...params, publicationKey: "snapshot-two" }));
  await waitFor(() => expect(reopened.result.current.detailStatus).toBe("ready"));
  expect(reopened.result.current.data.net.change).toBe(change);
  expect(requests).toHaveLength(6);
});

// Review of 428d209, finding 2: requests were unbound to the approved
// definitions; the client now checks what it can.
describe("Personal impact's live answers", () => {
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "snapshot-one" };
  const ENGINE = { policyengine: HOUSEHOLD_FIXTURE.engine.policyengine, "policyengine-uk": HOUSEHOLD_FIXTURE.engine["policyengine-uk"], "policyengine-core": HOUSEHOLD_FIXTURE.engine["policyengine-core"] };
  const serve = (requests, engineFor = () => HOUSEHOLD_FIXTURE.engine) => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return Response.json({ ...structuredClone(householdAnswerFor(body)), engine: engineFor(requests.length) });
    });
  };

  it("answers when the API runs the published package versions", async () => {
    const requests = [];
    serve(requests);
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.status).toBe("ready");
    expect(requests).toHaveLength(3);
  });

  it("refuses an answer from other package versions than the published figures", async () => {
    const requests = [];
    serve(requests);
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: { ...ENGINE, policyengine: "0.0.1" } }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
    expect(hook.result.current.error.packages).toEqual(["policyengine"]);
    expect(hook.result.current.data).toBeNull();
    // Not asked for the breakdown, and nothing cached to show later
    expect(requests).toHaveLength(1);
  });

  it("takes the whole answer away when the breakdown comes from another deployment", async () => {
    const requests = [];
    serve(requests, (n) => (n === 1 ? HOUSEHOLD_FIXTURE.engine : { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" }));
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
    expect(hook.result.current.data).toBeNull();
    expect(requests).toHaveLength(3);
  });

  // Review of e9d7c76: the detail service (#147, on Modal) is another build
  describe("with a detail service", () => {
    const MAIN = "https://main.test/api/household-impact";
    const DETAIL = "https://detail.test/api/household-impact";
    const partOf = (body) => (body.include.length === 0 ? "headline" : body.include[0]);
    const twoServices = (calls, detailAnswer, mainAnswer = (body) => ({ ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine })) => {
      vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
      vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
      vi.stubGlobal("fetch", async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(`${url === DETAIL ? "detail" : "main"}:${partOf(body)}`);
        return Response.json(url === DETAIL ? detailAnswer(body) : mainAnswer(body));
      });
    };
    const fromDetail = (change = {}) => (body) => {
      const answer = structuredClone(householdAnswerFor(body));
      return { ...answer, ...change(answer) };
    };

    it("uses a detail build that reports no project version (finding 1)", async () => {
      const calls = [];
      twoServices(calls, fromDetail(() => ({ engine: { ...HOUSEHOLD_FIXTURE.engine, uk_budget_data: null } })));
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
      expect(hook.result.current.status).toBe("ready");
      expect(hook.result.current.data.byPolicy).not.toBeNull();
      expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:headline"]);
    });

    for (const [why, change] of [
      ["other model versions", () => ({ engine: { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" } })],
      ["another net income (older measure definitions)", (answer) => ({ engine: HOUSEHOLD_FIXTURE.engine, net_income: { ...answer.net_income, reform: answer.net_income.reform + 5, change: answer.net_income.change + 5 } })],
    ]) {
      it(`asks the main API when the detail build answers with ${why}`, async () => {
        const calls = [];
        twoServices(calls, fromDetail(change));
        const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
        await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
        expect(hook.result.current.status).toBe("ready");
        expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
      });
    }

    it("takes the whole answer away when the main API's breakdown is from another build too", async () => {
      const calls = [];
      const other = (body) => ({ ...structuredClone(householdAnswerFor(body)), engine: { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" } });
      twoServices(calls, other, (body) => (partOf(body) === "headline" ? { ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine } : other(body)));
      const hook = renderHook(() => useHouseholdImpact(params));
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
      expect(hook.result.current.data).toBeNull();
    });
  });

  // Review of e9d7c76, finding 6: a refused calculation leaves nothing in
  // the cache, so asking again starts from the headline
  it("asks again from the headline after a refusal", async () => {
    const requests = [];
    serve(requests, (n) => (n === 1 || n >= 4 ? HOUSEHOLD_FIXTURE.engine : { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" }));
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    const asked = requests.length;
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(requests[asked].include).toEqual([]);
  });

  // Review of e9d7c76, finding 5: a part answered without what it was asked
  // for no longer leaves the breakdown loading for good
  it("says the breakdown is unavailable when a part comes back without it", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      const answer = { ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine };
      if (body.include[0] === "sweep") answer.sweep = null;
      return Response.json(answer);
    });
    const hook = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("error"));
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.data.byPolicy).not.toBeNull();
  });

  // The sweep and the split by policy are asked for at once (#147): one
  // part from another deployment takes the whole answer away, whether it
  // arrives before or after the other part, and the other part's later
  // answer never brings it back.
  for (const bad of ["sweep", "by_policy"]) {
    for (const badFirst of [true, false]) {
      it(`takes the whole answer away when only the ${bad} part comes from another deployment (${badFirst ? "it arrives first" : "it arrives last"})`, async () => {
        vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
        const requests = [];
        vi.stubGlobal("fetch", async (url, init) => {
          const body = JSON.parse(init.body);
          requests.push(body);
          const part = body.include.length === 0 ? "headline" : body.include[0];
          const isBad = part === bad;
          if (part !== "headline") await new Promise((resolve) => setTimeout(resolve, isBad === badFirst ? 0 : 60));
          const engine = isBad ? { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" } : HOUSEHOLD_FIXTURE.engine;
          return Response.json({ ...structuredClone(householdAnswerFor(body)), engine });
        });
        const hook = renderHook(() => useHouseholdImpact(params));
        await waitFor(() => expect(hook.result.current.status).toBe("error"));
        await waitFor(() => expect(requests).toHaveLength(3));
        // Past the slower part's answer
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(hook.result.current.status).toBe("error");
        expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
        expect(hook.result.current.data).toBeNull();
      });
    }
  }

  it("asks only after a check of the live publication that started after the request", async () => {
    const requests = [];
    const log = [];
    serve(requests);
    vi.stubGlobal("fetch", ((inner) => async (url, init) => {
      log.push("post");
      return inner(url, init);
    })(globalThis.fetch));
    const confirmPublication = vi.fn(async (snapshot) => {
      log.push(`check ${snapshot}`);
      return true;
    });
    const hook = renderHook(() => useHouseholdImpact({ ...params, confirmPublication }));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    // One check before the headline, one before the two detail parts
    expect(log).toEqual(["check snapshot-one", "post", "check snapshot-one", "post", "post"]);
  });

  it("drops the request when the snapshot it was made under is no longer live", async () => {
    const requests = [];
    serve(requests);
    const confirmPublication = vi.fn(async () => false);
    const hook = renderHook(() => useHouseholdImpact({ ...params, confirmPublication }));
    await waitFor(() => expect(confirmPublication).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toEqual([]);
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.status).not.toBe("ready");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache, detailServiceAsked, peekHouseholdImpact, rememberHouseholdHeadline, seedHouseholdImpactCache } from "./useHouseholdImpact";
import { EngineMismatchError, buildHouseholdRequest, normaliseHouseholdImpact, requestKey } from "../utils/householdImpactApi";
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
    // Both services deployed from one commit
    const BUILD = "c".repeat(40);
    const partOf = (body) => (body.include.length === 0 ? "headline" : body.include[0]);
    const fromMain = (body) => ({ ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine, git_sha: BUILD });
    const twoServices = (calls, detailAnswer, mainAnswer = fromMain, { statusOf = () => 200 } = {}) => {
      vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
      vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
      vi.stubGlobal("fetch", async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(`${url === DETAIL ? "detail" : "main"}:${partOf(body)}`);
        const answer = await (url === DETAIL ? detailAnswer(body) : mainAnswer(body));
        return Response.json(answer, { status: statusOf(answer) });
      });
    };
    const fromDetail = (change = () => ({})) => (body) => {
      const answer = { ...structuredClone(householdAnswerFor(body)), git_sha: BUILD };
      return { ...answer, ...change(answer) };
    };
    // The sweep's top point as another definition would give it, the
    // household's own net income unchanged
    const otherSweep = (sweep) => sweep && {
      ...sweep,
      points: sweep.points.map((point, i) => (i === sweep.points.length - 1 ? { ...point, reform: point.reform - 250, change: point.change - 250 } : point)),
    };
    const mainSweep = normaliseHouseholdImpact(householdAnswerFor({ include: ["sweep"] })).sweep;

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
      // Review of d2ec6f2, finding 1
      ["another commit, though the same packages and net income (another sweep)", (answer) => ({ git_sha: "d".repeat(40), sweep: otherSweep(answer.sweep) })],
      ["no commit (a deploy from an edited checkout, or an older build)", (answer) => ({ git_sha: null, sweep: otherSweep(answer.sweep) })],
      // W5's review of #104: an answer without its part was accepted, and
      // the breakdown then said it was unavailable
      ["neither part it was asked for", () => ({ by_policy: null, sweep: null })],
      ["a malformed commit", (answer) => ({ git_sha: "not-a-commit", sweep: otherSweep(answer.sweep) })],
    ]) {
      it(`asks the main API when the detail build answers with ${why}`, async () => {
        const calls = [];
        twoServices(calls, fromDetail(change));
        const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
        await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
        expect(hook.result.current.status).toBe("ready");
        expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
        // The sweep shown, and cached, is the main API's
        expect(hook.result.current.data.sweep).toEqual(mainSweep);
        hook.unmount();
        const again = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
        expect(again.result.current.data.sweep).toEqual(mainSweep);
        expect(calls).toHaveLength(5);
      });
    }

    // A headline with no commit (Cloud Run at f3304ff, 27 October): no
    // detail answer could be used under it, so the page does not wait for
    // one (up to a Modal cold start) before asking Cloud Run
    // #250: the first calculation asks the detail service with its
    // headline, before it knows the headline reports no commit; its answers
    // are not used, and later calculations do not ask it early
    it("never uses the detail service under a headline that reports no commit, and stops asking it early", async () => {
      const calls = [];
      twoServices(calls, fromDetail(), (body) => ({ ...fromMain(body), git_sha: null }));
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
      expect(calls.filter((call) => call.startsWith("main:")).sort()).toEqual([
        "main:by_policy",
        "main:headline",
        "main:sweep",
      ]);
      expect(hook.result.current.data.byPolicy).not.toBeNull();
      expect(hook.result.current.data.sweep).not.toBeNull();
      hook.unmount();
      calls.length = 0;
      const next = renderHook(() => useHouseholdImpact({ ...params, year: 2030, expectedEngine: ENGINE }));
      await waitFor(() => expect(next.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["main:by_policy", "main:headline", "main:sweep"]);
    });

    // Cloud Run redeployed, Modal not (or the other way round): the first
    // breakdown finds out, and the rest of the session asks Cloud Run alone
    it("stops asking the detail service for the session once it answers from another build", async () => {
      const calls = [];
      twoServices(calls, fromDetail(() => ({ git_sha: null })));
      const first = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(first.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
      expect(detailServiceAsked()).toBe(false);
      first.unmount();
      calls.length = 0;
      const next = renderHook(() => useHouseholdImpact({ ...params, year: 2030, expectedEngine: ENGINE }));
      await waitFor(() => expect(next.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["main:by_policy", "main:headline", "main:sweep"]);
      // A new session (here, the cache cleared) asks it again
      clearHouseholdImpactCache();
      expect(detailServiceAsked()).toBe(true);
    });

    it("keeps asking the detail service while it answers from the headline's build", async () => {
      const calls = [];
      twoServices(calls, fromDetail());
      const first = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(first.result.current.detailStatus).toBe("ready"));
      first.unmount();
      const next = renderHook(() => useHouseholdImpact({ ...params, year: 2030, expectedEngine: ENGINE }));
      await waitFor(() => expect(next.result.current.detailStatus).toBe("ready"));
      expect(calls.filter((call) => call.startsWith("detail:"))).toHaveLength(4);
      expect(calls.filter((call) => call !== "main:headline")).toEqual(calls.filter((call) => call.startsWith("detail:")));
      expect(detailServiceAsked()).toBe(true);
    });

    // Both services redeployed from one commit while the tab is open: the
    // commit appears in the answers only now, and the detail service is
    // asked from the first headline that reports it
    it("asks the detail service once the headline starts reporting a commit", async () => {
      const calls = [];
      let mainBuild = null;
      twoServices(calls, fromDetail(), (body) => ({ ...fromMain(body), git_sha: mainBuild }));
      const before = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(before.result.current.detailStatus).toBe("ready"));
      // Asked early with the first headline (#250), not used under it
      expect(calls.filter((call) => call.startsWith("main:")).sort()).toEqual([
        "main:by_policy",
        "main:headline",
        "main:sweep",
      ]);
      expect(detailServiceAsked()).toBe(true);
      before.unmount();
      calls.length = 0;
      mainBuild = BUILD;
      const after = renderHook(() => useHouseholdImpact({ ...params, year: 2030, expectedEngine: ENGINE }));
      await waitFor(() => expect(after.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:headline"]);
      expect(after.result.current.data.byPolicy).not.toBeNull();
      expect(after.result.current.data.sweep).not.toBeNull();
    });

    // A headline kept in the cache from before a redeploy (an example card's,
    // say) is not the main API's current build: a detail answer from the new
    // build is refused under it, but the session keeps asking the detail
    // service
    it("doesn't stop asking the detail service over a headline kept from an earlier deploy", async () => {
      const calls = [];
      twoServices(calls, fromDetail());
      const key = `${params.publicationKey}:${requestKey(buildHouseholdRequest(params.inputs, { year: params.year, policies: params.policies }))}`;
      const old = normaliseHouseholdImpact({ ...fromMain(buildHouseholdRequest(params.inputs, { year: params.year, policies: params.policies })), git_sha: "d".repeat(40) });
      rememberHouseholdHeadline(key, { ...old, byPolicy: null, sweep: null });
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(calls).not.toContain("main:headline");
      expect(calls.filter((call) => call.startsWith("detail:")).sort()).toEqual(["detail:by_policy", "detail:sweep"]);
      expect(detailServiceAsked()).toBe(true);
    });

    // A detail service that is down is not another build: it may be back
    // for the next calculation
    it("asks the detail service again after it failed, as it is not another build", async () => {
      const calls = [];
      twoServices(calls, () => ({ detail: "down" }), fromMain, { statusOf: (answer) => (answer.detail === "down" ? 503 : 200) });
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
      expect(detailServiceAsked()).toBe(true);
    });

    // Review of e78fbf4, finding 2: under a headline with no commit, each
    // Cloud Run part passed against that null, from whichever revision
    for (const sweepFirst of [true, false]) {
      it(`takes the whole answer away when Cloud Run's two parts report different commits under a headline with none (${sweepFirst ? "sweep" : "split"} first)`, async () => {
        const calls = [];
        twoServices(calls, fromDetail(), async (body) => {
          const part = partOf(body);
          if (part !== "headline") await new Promise((resolve) => setTimeout(resolve, (part === "sweep") === sweepFirst ? 0 : 60));
          return { ...fromMain(body), git_sha: { headline: null, sweep: "d".repeat(40), by_policy: "e".repeat(40) }[part] };
        });
        const hook = renderHook(() => useHouseholdImpact(params));
        await waitFor(() => expect(hook.result.current.status).toBe("error"));
        expect(hook.result.current.error.packages).toEqual(["build"]);
        expect(hook.result.current.data).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(hook.result.current.data).toBeNull();
      });
    }

    it("refuses a retried part from another commit than the part already cached", async () => {
      const calls = [];
      let splits = 0;
      twoServices(
        calls,
        () => ({ detail: "down" }),
        (body) => {
          const part = partOf(body);
          if (part === "by_policy") {
            splits += 1;
            // Cloud Run fails the split once, then answers from another revision
            if (splits === 1) return { status: 503 };
          }
          return { ...fromMain(body), git_sha: { headline: null, sweep: "d".repeat(40), by_policy: "e".repeat(40) }[part] };
        },
        { statusOf: (answer) => answer.status ?? (answer.detail === "down" ? 503 : 200) },
      );
      const hook = renderHook(() => useHouseholdImpact(params));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("error"));
      // The sweep from commit d is shown, and cached as a partial result
      expect(hook.result.current.data.sweep).not.toBeNull();
      expect(hook.result.current.data.byPolicy).toBeNull();
      act(() => hook.result.current.retry());
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(hook.result.current.error.packages).toEqual(["build"]);
      expect(hook.result.current.data).toBeNull();
    });

    it("takes the whole answer away when the main API's breakdown reports another commit than its headline", async () => {
      const calls = [];
      twoServices(calls, fromDetail(() => ({ git_sha: null })), (body) => ({ ...fromMain(body), git_sha: partOf(body) === "headline" ? BUILD : "e".repeat(40) }));
      const hook = renderHook(() => useHouseholdImpact(params));
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(hook.result.current.error).toBeInstanceOf(EngineMismatchError);
      expect(hook.result.current.error.packages).toEqual(["build"]);
      expect(hook.result.current.data).toBeNull();
    });

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

  // A refused calculation leaves nothing in the cache, so asking again
  // starts from the headline. (The review of e9d7c76 asked for this; that
  // commit already did it, so this guards it rather than a change.) Without
  // refuse()'s cache.delete, the retry would reuse the refused headline.
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
        const signals = {};
        vi.stubGlobal("fetch", async (url, init) => {
          const body = JSON.parse(init.body);
          requests.push(body);
          const part = body.include.length === 0 ? "headline" : body.include[0];
          signals[part] = init.signal;
          const isBad = part === bad;
          if (part !== "headline") await new Promise((resolve) => setTimeout(resolve, isBad === badFirst ? 0 : 60));
          const engine = isBad ? { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "9.9.9" } : HOUSEHOLD_FIXTURE.engine;
          return Response.json({ ...structuredClone(householdAnswerFor(body)), engine });
        });
        const hook = renderHook(() => useHouseholdImpact(params));
        await waitFor(() => expect(hook.result.current.status).toBe("error"));
        await waitFor(() => expect(requests).toHaveLength(3));
        // Review of d2ec6f2: the refusal cancels the other part's request
        // while it is still out
        if (badFirst) expect(signals[bad === "sweep" ? "by_policy" : "sweep"].aborted).toBe(true);
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

// #104 review (m23, P1): every read of the session cache checks the engine,
// whoever wrote the entry. A seeded answer was checked only against the
// engine its writer had, which may have been none.
describe("an answer already in the session cache", () => {
  const ENGINE = { policyengine: HOUSEHOLD_FIXTURE.engine.policyengine, "policyengine-uk": HOUSEHOLD_FIXTURE.engine["policyengine-uk"], "policyengine-core": HOUSEHOLD_FIXTURE.engine["policyengine-core"] };
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "snapshot-one", expectedEngine: ENGINE };
  const key = `snapshot-one:${requestKey(buildHouseholdRequest(WIZARD_DEFAULTS, { year: 2029, policies: HOUSEHOLD_FIXTURE.included }))}`;
  const seeded = (engine) => {
    const answer = structuredClone(householdAnswerFor(buildHouseholdRequest(WIZARD_DEFAULTS, { year: 2029, policies: HOUSEHOLD_FIXTURE.included, include: ["by_policy", "sweep"] })));
    answer.net_income.change = 4242;
    return normaliseHouseholdImpact({ ...answer, engine });
  };
  let requests;
  beforeEach(() => {
    requests = 0;
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      requests += 1;
      return Response.json(householdAnswerFor(JSON.parse(init.body)));
    });
  });

  it("is shown at once, asking nothing, when the receipts record its engine", async () => {
    seedHouseholdImpactCache([[key, seeded(HOUSEHOLD_FIXTURE.engine)]]);
    const { result } = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data.net.change).toBe(4242);
    expect(requests).toBe(0);
  });

  it("is a miss under another engine: the API answers, and its answer replaces the entry", async () => {
    seedHouseholdImpactCache([[key, seeded({ ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "0.0.0-other" })]]);
    const { result } = renderHook(() => useHouseholdImpact(params));
    await waitFor(() => expect(result.current.detailStatus).toBe("ready"));
    expect(requests).toBeGreaterThan(0);
    expect(result.current.data.net.change).not.toBe(4242);
    expect(peekHouseholdImpact(key, ENGINE).net.change).toBe(result.current.data.net.change);
  });

  it("is never returned by a peek under another engine", () => {
    seedHouseholdImpactCache([[key, seeded({ ...HOUSEHOLD_FIXTURE.engine, policyengine: "0.0.0-other" })]]);
    expect(peekHouseholdImpact(key, ENGINE)).toBeNull();
    // A reader that expects no engine sees it (none is shown that way: the
    // page expects one whenever a measure is selected)
    expect(peekHouseholdImpact(key)).not.toBeNull();
  });
});

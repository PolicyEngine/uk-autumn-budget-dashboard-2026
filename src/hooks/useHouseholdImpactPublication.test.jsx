import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
import {
  BY_POLICY_INCLUDE,
  DefinitionMismatchError,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  SWEEP_INCLUDE,
  UNREGISTERED,
  normaliseHouseholdImpact,
} from "../utils/householdImpactApi";
import { APPROVED_COMMIT, approvedDefinition, reportedDefinitions, requestedDefinitions } from "../test/definitionsFixture";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

beforeEach(clearHouseholdImpactCache);

// Every fixture measure's approved definition, which an API running the
// approved code reports back (reportedDefinitions)
const DEFINITIONS = Object.fromEntries(HOUSEHOLD_FIXTURE.included.map((id) => [id, approvedDefinition()]));
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
    expect(url.split("?")[0]).toBe("https://api.test/api/household-impact");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    requests.push(body);
    const answer = structuredClone(householdAnswerFor(body));
    answer.net_income.change = change;
    answer.net_income.reform = answer.net_income.baseline + change;
    return Response.json({ ...answer, definitions: reportedDefinitions(url) });
  });
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, expectedDefinitions: DEFINITIONS };
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
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "snapshot-one", expectedDefinitions: DEFINITIONS };
  const ENGINE = { policyengine: HOUSEHOLD_FIXTURE.engine.policyengine, "policyengine-uk": HOUSEHOLD_FIXTURE.engine["policyengine-uk"], "policyengine-core": HOUSEHOLD_FIXTURE.engine["policyengine-core"] };
  const serve = (requests, engineFor = () => HOUSEHOLD_FIXTURE.engine) => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return Response.json({ ...structuredClone(householdAnswerFor(body)), engine: engineFor(requests.length), definitions: reportedDefinitions(url) });
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
        // Each request names the asked measures' definitions in its query,
        // and both services run the approved definitions (#136)
        const detail = String(url).split("?")[0] === DETAIL;
        calls.push(`${detail ? "detail" : "main"}:${partOf(body)}`);
        const answer = await (detail ? detailAnswer(body) : mainAnswer(body));
        return Response.json({ definitions: reportedDefinitions(url), ...answer }, { status: statusOf(answer) });
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

    it("never uses the detail service under a headline that reports no commit", async () => {
      const calls = [];
      twoServices(calls, fromDetail(), (body) => ({ ...fromMain(body), git_sha: null }));
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedEngine: ENGINE }));
      await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
      expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
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
      const answer = { ...structuredClone(householdAnswerFor(body)), engine: HOUSEHOLD_FIXTURE.engine, definitions: reportedDefinitions(url) };
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
          return Response.json({ ...structuredClone(householdAnswerFor(body)), engine, definitions: reportedDefinitions(url) });
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

// W5's page follow-up to #125: each measure's answer must be computed from
// the definition its receipt approved, checked on both stages.
describe("Household impact's definitions", () => {
  const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "snapshot-one" };
  const expectedDefinitions = DEFINITIONS;
  const [first, second] = [...HOUSEHOLD_FIXTURE.included].sort();
  const changed = (definitions, id) => ({
    ...definitions,
    [id]: { ...definitions[id], reform: { ...definitions[id].reform, reform_sha256: "e".repeat(64) } },
  });
  // Answer request n with `definitionsFor(n, reported, body)`, `reported`
  // being what an API running the approved code reports
  const serve = (requests, definitionsFor = (n, reported) => reported) => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      const answer = structuredClone(householdAnswerFor(body));
      const definitions = definitionsFor(requests.length, reportedDefinitions(url), body);
      return Response.json(definitions === undefined ? answer : { ...answer, definitions });
    });
  };

  it("answers when every measure's definition is the approved one, naming them on every request", async () => {
    const requests = [];
    serve(requests);
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
    expect(hook.result.current.status).toBe("ready");
    // The headline, then the sweep and the split by policy
    expect(requests).toHaveLength(3);
    for (const { url } of requests) {
      expect(requestedDefinitions(url)).toEqual([...HOUSEHOLD_FIXTURE.included].sort().map((id) => [id, APPROVED_COMMIT]));
    }
  });

  it("refuses a headline computed from another definition, naming only that measure", async () => {
    const requests = [];
    serve(requests, (n, reported) => changed(reported, second));
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
    expect(hook.result.current.error.refused).toEqual([{ id: second, problems: ["its reform reform_sha256 differs"] }]);
    expect(hook.result.current.error.unchecked).toBe(false);
    expect(hook.result.current.data).toBeNull();
    // Not asked for the breakdown
    expect(requests).toHaveLength(1);
  });

  it("refuses an answer from a build that reports no definitions", async () => {
    const requests = [];
    serve(requests, () => undefined);
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error.refused.map((item) => item.id)).toEqual([...HOUSEHOLD_FIXTURE.included].sort());
    expect(hook.result.current.error.refused.every((item) => item.problems[0] === "no definition reported")).toBe(true);
    // Nothing it reports tells the measures apart (HouseholdCalculator
    // offers to ask again, not to remove them all)
    expect(hook.result.current.error.unchecked).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("refuses a selected measure with no approved definition before asking", async () => {
    const requests = [];
    serve(requests);
    const { [first]: _dropped, ...partial } = expectedDefinitions;
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions: partial }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error.refused).toEqual([{ id: first, problems: ["no approved definition to check it against"] }]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(requests).toEqual([]);
  });

  // Review of 0608183, finding 6: the default was to check nothing
  it("refuses every selected measure before asking when given no approved definitions", async () => {
    const requests = [];
    serve(requests);
    const { expectedDefinitions: _none, ...unchecked } = params;
    const hook = renderHook(() => useHouseholdImpact(unchecked));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
    expect(hook.result.current.error.refused).toEqual(
      [...HOUSEHOLD_FIXTURE.included].sort().map((id) => ({ id, problems: ["no approved definition to check it against"] })),
    );
    expect(hook.result.current.data).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(requests).toEqual([]);
  });

  // Review of 0608183, finding 2: the API refuses a measure its code
  // doesn't register with a 422 before it reports any definition
  it("refuses a measure the running code doesn't register, from the API's 422", async () => {
    const requests = [];
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      return Response.json(
        { detail: [{ type: "value_error", loc: ["body", "policies"], msg: `Value error, Unknown measures: ${second}`, input: body.policies, ctx: { error: {} } }] },
        { status: 422 },
      );
    });
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
    expect(hook.result.current.error.refused).toEqual([{ id: second, problems: [`the running code cannot bind it: ${UNREGISTERED}`] }]);
    expect(hook.result.current.data).toBeNull();
    expect(requests).toHaveLength(1);
  });

  // Each detail part is checked on its own (#147 asks for them at once):
  // either one from another definition takes the whole answer away
  for (const bad of ["sweep", "by_policy"]) {
    it(`takes the whole answer away when the ${bad} part is computed from another definition, and keeps nothing`, async () => {
      const requests = [];
      serve(requests, (n, reported, body) => (body.include[0] === bad ? changed(reported, first) : reported));
      const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
      await waitFor(() => expect(hook.result.current.status).toBe("error"));
      expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
      expect(hook.result.current.error.refused.map((item) => item.id)).toEqual([first]);
      expect(hook.result.current.data).toBeNull();
      await waitFor(() => expect(requests).toHaveLength(3));
      // Past the other part's answer, which never brings it back
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(hook.result.current.status).toBe("error");
      expect(hook.result.current.data).toBeNull();
      hook.unmount();
      // Nothing cached, not even the headline: the same request starts again
      // from the headline, with nothing on screen meanwhile
      const again = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
      expect(again.result.current.data).toBeNull();
      await waitFor(() => expect(requests.length).toBeGreaterThan(3));
      expect(requests[3].body.include).toEqual(HEADLINE_INCLUDE);
      again.unmount();
    });
  }

  // Review of 0608183, finding 4: a headline kept from before goes straight
  // to the breakdown, which must be checked as a fresh headline would be
  it("refuses a breakdown from another definition under a headline kept from before", async () => {
    const requests = [];
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      // The first breakdown's two parts fail; the API is then redeployed
      if (requests.length === 2 || requests.length === 3) throw new TypeError("Failed to fetch");
      const reported = reportedDefinitions(url);
      return Response.json({
        ...structuredClone(householdAnswerFor(body)),
        definitions: requests.length > 3 ? changed(reported, first) : reported,
      });
    });
    const hook = renderHook(() => useHouseholdImpact({ ...params, expectedDefinitions }));
    await waitFor(() => expect(hook.result.current.detailStatus).toBe("error"));
    expect(hook.result.current.status).toBe("ready");
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
    expect(hook.result.current.error.refused.map((item) => item.id)).toEqual([first]);
    expect(hook.result.current.data).toBeNull();
    // The retry asked only for the breakdown: the headline was the kept one
    expect(requests.map((request) => request.body.include)).toEqual([
      HEADLINE_INCLUDE,
      SWEEP_INCLUDE,
      BY_POLICY_INCLUDE,
      SWEEP_INCLUDE,
      BY_POLICY_INCLUDE,
    ]);
  });
});

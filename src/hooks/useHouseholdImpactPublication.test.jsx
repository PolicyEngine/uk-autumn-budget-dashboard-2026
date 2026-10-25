import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
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
  expect(requests).toHaveLength(2);
  first.unmount();

  change += 111;
  const second = renderHook(() => useHouseholdImpact({ ...params, publicationKey: "snapshot-two" }));
  expect(second.result.current.data).toBeNull();
  await waitFor(() => expect(second.result.current.detailStatus).toBe("ready"));
  expect(requests).toHaveLength(4);
  expect(requests[2]).toEqual(requests[0]);
  expect(requests[3]).toEqual(requests[1]);
  expect(second.result.current.data.net.change).toBe(change);
  second.unmount();

  // Reopening the same snapshot still benefits from its completed cache.
  const reopened = renderHook(() => useHouseholdImpact({ ...params, publicationKey: "snapshot-two" }));
  await waitFor(() => expect(reopened.result.current.detailStatus).toBe("ready"));
  expect(reopened.result.current.data.net.change).toBe(change);
  expect(requests).toHaveLength(4);
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
    expect(requests).toHaveLength(2);
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
    expect(requests).toHaveLength(2);
  });

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
    expect(log).toEqual(["check snapshot-one", "post", "check snapshot-one", "post"]);
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

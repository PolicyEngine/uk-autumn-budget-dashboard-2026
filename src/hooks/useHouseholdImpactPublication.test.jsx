import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
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

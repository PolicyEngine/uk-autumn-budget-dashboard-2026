import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
import { DefinitionMismatchError, HEADLINE_INCLUDE } from "../utils/householdImpactApi";
import { approvedDefinition, reportedDefinitions } from "../test/definitionsFixture";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

// The detail URL (#147) answers the sweep and the split by policy; the
// page checks its answers as it checks the main API's, and falls back to
// the main API only when a request gets no usable answer (review of
// 48ac26e9: neither case below was tested).
const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const DEFINITIONS = Object.fromEntries(HOUSEHOLD_FIXTURE.included.map((id) => [id, approvedDefinition()]));
const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "s", expectedDefinitions: DEFINITIONS };
const route = (url) => String(url).split("?")[0];

beforeEach(() => {
  clearHouseholdImpactCache();
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", MAIN);
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL", DETAIL);
});
afterEach(() => {
  cleanup();
  clearHouseholdImpactCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("refuses the whole result, as unchecked, when the detail URL's parts report no definitions (an app built before #125), with no fallback", async () => {
  const requests = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: route(url), include: body.include });
    const answer = structuredClone(householdAnswerFor(body));
    return Response.json(route(url) === MAIN ? { ...answer, definitions: reportedDefinitions(url) } : answer);
  });
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.status).toBe("error"));
  expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
  expect(hook.result.current.error.unchecked).toBe(true);
  expect(hook.result.current.data).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(hook.result.current.data).toBeNull();
  expect(requests.filter((r) => r.url === MAIN).map((r) => r.include)).toEqual([HEADLINE_INCLUDE]);
});

it("refuses a measure the detail URL's code doesn't register (422), with no fallback to the main API", async () => {
  const [, second] = [...HOUSEHOLD_FIXTURE.included].sort();
  const requests = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: route(url), include: body.include });
    if (route(url) === DETAIL) {
      return Response.json(
        { detail: [{ type: "value_error", loc: ["body", "policies"], msg: `Value error, Unknown measures: ${second}` }] },
        { status: 422 },
      );
    }
    return Response.json({ ...structuredClone(householdAnswerFor(body)), definitions: reportedDefinitions(url) });
  });
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.status).toBe("error"));
  expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
  expect(hook.result.current.error.refused.map((item) => item.id)).toEqual([second]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(requests.filter((r) => r.url === MAIN).map((r) => r.include)).toEqual([HEADLINE_INCLUDE]);
});

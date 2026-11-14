import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache } from "./useHouseholdImpact";
import { approvedDefinition, reportedDefinitions } from "../test/definitionsFixture";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

// Coordinator, 26 October: the timeout ended when the response arrived, so
// a detail answer whose body never ended left the breakdown loading; now it
// times out and the part is asked again of the main API. The detail stage's
// timeout, and the detail service's own (MODAL_TIMEOUT_MS, which bounds its
// requests since PR 265, the early ones too), are cut to 100 ms here, so the
// case runs in real time.
vi.mock("../utils/householdImpactApi", async (importOriginal) => ({
  ...(await importOriginal()),
  DETAIL_TIMEOUT_MS: 100,
  MODAL_TIMEOUT_MS: 100,
}));

const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const BUILD = "c".repeat(40);
const DEFINITIONS = Object.fromEntries(HOUSEHOLD_FIXTURE.included.map((id) => [id, approvedDefinition()]));
const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "s", expectedDefinitions: DEFINITIONS };

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

it("asks the main API for the parts when the detail URL's answer never ends, and shows its answer", async () => {
  const calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    const service = String(url).split("?")[0] === DETAIL ? "detail" : "main";
    calls.push(`${service}:${body.include.length === 0 ? "headline" : body.include[0]}`);
    // Headers, then a body that never ends
    if (service === "detail") return new Response(new ReadableStream(), { headers: { "Content-Type": "application/json" } });
    return Response.json({ ...structuredClone(householdAnswerFor(body)), git_sha: BUILD, definitions: reportedDefinitions(url) });
  });
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"), { timeout: 5000 });
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.data.byPolicy).not.toBeNull();
  expect(hook.result.current.data.sweep).not.toBeNull();
  expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"]);
});

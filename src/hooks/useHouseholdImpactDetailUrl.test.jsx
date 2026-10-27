import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useHouseholdImpact, { clearHouseholdImpactCache, setHouseholdRetryPolicy } from "./useHouseholdImpact";
import { DefinitionMismatchError, HEADLINE_INCLUDE } from "../utils/householdImpactApi";
import { approvedDefinition, reportedDefinitions, requestedDefinitions } from "../test/definitionsFixture";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

// The detail URL (#147) answers the sweep and the split by policy. Its
// answers are checked as the main API's are, and a part it can't answer
// from the headline's build and the approved definitions (a stale or
// pre-#125 deploy, or one that doesn't register a measure) is asked again
// of the main API (coordinator, 25 October, on m13's fallback). Only the
// main API's own mismatch refuses the whole result. Both services report
// one build commit here (#104's m16 checks it first), so each case turns
// on the definitions alone.
const MAIN = "https://main.test/api/household-impact";
const DETAIL = "https://detail.test/api/household-impact";
const BUILD = "c".repeat(40);
const DEFINITIONS = Object.fromEntries(HOUSEHOLD_FIXTURE.included.map((id) => [id, approvedDefinition()]));
const params = { inputs: WIZARD_DEFAULTS, year: 2029, policies: HOUSEHOLD_FIXTURE.included, enabled: true, publicationKey: "s", expectedDefinitions: DEFINITIONS };
const route = (url) => String(url).split("?")[0];
const partOf = (body) => (body.include.length === 0 ? "headline" : body.include[0]);
// What a build computing each measure from another definition reports
const stale = (id) => ({ ...approvedDefinition(id), reform: { ...approvedDefinition(id).reform, reform_sha256: "e".repeat(64) } });
const [, SECOND] = [...HOUSEHOLD_FIXTURE.included].sort();
const UNREGISTERED_422 = () =>
  Response.json(
    { detail: [{ type: "value_error", loc: ["body", "policies"], msg: `Value error, Unknown measures: ${SECOND}` }] },
    { status: 422 },
  );

// Each service answers as `answer(service, part, url, body)` says: an
// object is sent with the request's answer under it, a Response as it is
const serve = (calls, answer) => {
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    const service = route(url) === DETAIL ? "detail" : "main";
    calls.push(`${service}:${partOf(body)}`);
    const given = answer(service, partOf(body), url, body);
    if (given instanceof Response) return given;
    return Response.json({ ...structuredClone(householdAnswerFor(body)), git_sha: BUILD, ...given });
  });
};
const good = (url) => ({ definitions: reportedDefinitions(url) });
const mismatched = (url) => ({ definitions: reportedDefinitions(url, stale) });
const PARTS_FROM_BOTH = ["detail:by_policy", "detail:sweep", "main:by_policy", "main:headline", "main:sweep"];

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

async function answered(calls) {
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
  expect(hook.result.current.status).toBe("ready");
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.data.byPolicy).not.toBeNull();
  expect(hook.result.current.data.sweep).not.toBeNull();
  expect(calls.sort()).toEqual(PARTS_FROM_BOTH);
}

async function refused(calls, unchecked = false) {
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.status).toBe("error"));
  expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
  expect(hook.result.current.error.unchecked).toBe(unchecked);
  expect(hook.result.current.data).toBeNull();
  // A later part's answer never brings it back
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(hook.result.current.data).toBeNull();
  expect(calls).toContain("main:headline");
  return hook.result.current.error;
}

it("uses the detail URL's parts when they are computed from the approved definitions", async () => {
  const calls = [];
  serve(calls, (service, part, url) => good(url));
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
  expect(hook.result.current.error).toBeNull();
  expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:headline"]);
});

it("asks the main API for the parts when the detail URL computes a measure from another definition, and shows its answer", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "detail" ? mismatched(url) : good(url)));
  await answered(calls);
});

it("asks the main API for the parts when the detail URL's report no definitions (a deploy before PR 125)", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "detail" ? {} : good(url)));
  await answered(calls);
});

it("asks the main API when the detail URL's code doesn't register a measure (422)", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "detail" ? UNREGISTERED_422() : good(url)));
  await answered(calls);
});

// Review of 61df4725, finding 2: a detail answer without the part it was
// asked for doesn't answer that part
it("asks the main API for a part the detail URL's answer leaves out", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "detail" && part === "sweep" ? { ...good(url), sweep: null } : good(url)));
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.detailStatus).toBe("ready"));
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.data.sweep).not.toBeNull();
  expect(calls.sort()).toEqual(["detail:by_policy", "detail:sweep", "main:headline", "main:sweep"]);
});

it("takes the whole answer away when the main API computes a part from another definition", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "detail" ? new Response(null, { status: 503 }) : part === "headline" ? good(url) : mismatched(url)));
  const error = await refused(calls);
  expect(error.refused.map((item) => item.id)).toEqual([...HOUSEHOLD_FIXTURE.included].sort());
});

it("takes the whole answer away when the detail URL and then the main API both compute a part from another definition", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "main" && part === "headline" ? good(url) : mismatched(url)));
  await refused(calls);
  expect(calls).toEqual(expect.arrayContaining(["detail:by_policy", "detail:sweep", "main:by_policy", "main:sweep"]));
});

it("takes the whole answer away, as unchecked, when the main API's parts report no definitions either", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "main" && part === "headline" ? good(url) : {}));
  await refused(calls, true);
});

it("passes on the main API's own refusal of a measure its code doesn't register", async () => {
  const calls = [];
  serve(calls, (service, part, url) => (service === "main" && part === "headline" ? good(url) : UNREGISTERED_422()));
  const error = await refused(calls);
  expect(error.refused.map((item) => item.id)).toEqual([SECOND]);
});

// m13: once a part refuses the whole answer, the other part's request is
// stopped, wherever it was sent. With a detail URL the parts are also asked
// for early, with the headline (#252), so the sweep can have two requests:
// each is stopped
it("stops the other part's request once a part takes the whole answer away", async () => {
  const sweeps = [];
  vi.stubGlobal("fetch", (url, init) => {
    const body = JSON.parse(init.body);
    if (partOf(body) === "sweep") {
      sweeps.push(init.signal);
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    const definitions = partOf(body) === "headline" ? good(url) : mismatched(url);
    return Promise.resolve(Response.json({ ...structuredClone(householdAnswerFor(body)), ...definitions }));
  });
  const hook = renderHook(() => useHouseholdImpact(params));
  await waitFor(() => expect(hook.result.current.status).toBe("error"));
  expect(hook.result.current.error).toBeInstanceOf(DefinitionMismatchError);
  expect(sweeps.length).toBeGreaterThan(0);
  await waitFor(() => expect(sweeps.every((signal) => signal.aborted)).toBe(true));
});

// PR 265 asks a headline again while the service looks to be starting up:
// the retry names the approved commits as the first ask did, and its answer
// is checked as a first one is
it("refuses a headline, asked again after a 503, that computes a measure from another definition", async () => {
  setHouseholdRetryPolicy({ delayMs: 1, maxRetryAfterMs: 1, minAttemptMs: 1 });
  const calls = [];
  const named = [];
  serve(calls, (service, part, url) => {
    if (part !== "headline") return good(url);
    named.push(requestedDefinitions(url));
    return named.length === 1 ? new Response(null, { status: 503 }) : mismatched(url);
  });
  await refused(calls);
  expect(calls.filter((call) => call === "main:headline")).toHaveLength(2);
  expect(named[0].map(([id]) => id)).toEqual([...HOUSEHOLD_FIXTURE.included].sort());
  expect(named[1]).toEqual(named[0]);
});

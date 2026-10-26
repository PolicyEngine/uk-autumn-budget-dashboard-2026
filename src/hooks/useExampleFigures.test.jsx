import { act, renderHook, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useExampleFigures, { EXAMPLE_FILL_CONCURRENCY, exampleKey, readStoredHeadline, runLimited, unknownMeasures } from "./useExampleFigures";
import { clearHouseholdImpactCache, peekHouseholdImpact, seedHouseholdImpactCache } from "./useHouseholdImpact";
import {
  DefinitionMismatchError,
  HouseholdApiError,
  UNREGISTERED_PROBLEM,
  buildHouseholdRequest,
  normaliseHouseholdImpact,
  postHouseholdDetail,
} from "../utils/householdImpactApi";
import { APPROVED_COMMIT, approvedDefinition, reportedDefinitions, requestedDefinitions, route } from "../test/definitionsFixture";
import { SELECTABLE_YEARS } from "../utils/displayYears";
import { HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";
import { presetInputs } from "../utils/householdPresets";

const EXAMPLES = HOUSEHOLD_EXAMPLES.slice(0, 2).map((example) => ({ id: example.id, inputs: presetInputs(example) }));
const POLICIES = ["fuel_duty_rise_deferral"];
const YEAR = SELECTABLE_YEARS[0];
const CELLS = EXAMPLES.length * SELECTABLE_YEARS.length;
// Every measure these tests select has the same synthetic approval
const DEFINITIONS = Object.fromEntries(
  ["fuel_duty_rise_deferral", "road_fuel_vat_cut", "mock_measure"].map((id) => [id, approvedDefinition()]),
);
const approvedFor = (ids) => Object.fromEntries(ids.map((id) => [id, DEFINITIONS[id]]));

// An answer with no `definitions` at all (a build before #125). Not
// `undefined`: passed for a default parameter, that takes the default
const NO_DEFINITIONS = Symbol("no definitions");

// A request the test answers when it chooses: every call is kept, with its
// body, signal, the definitions it names and how to answer it. By default
// an answer reports the definitions the request named, as an API running
// the approved code does
function deferredPost() {
  const calls = [];
  const post = (body, { signal, definitions, accept }) =>
    new Promise((resolve, reject) => {
      const call = { body, signal, definitions, accept, resolve, reject, done: false };
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      calls.push(call);
    });
  const answer = (call, change = 10, reported = call.definitions) => {
    call.done = true;
    call.resolve({
      year: call.body.year,
      net_income: { baseline: 20000, reform: 20000 + change, change },
      ...(reported === NO_DEFINITIONS ? {} : { definitions: reported }),
    });
  };
  return { post, calls, answer };
}

const render = (props) =>
  renderHook((p) => useExampleFigures(p), {
    initialProps: { examples: EXAMPLES, policies: POLICIES, year: YEAR, enabled: true, expectedDefinitions: DEFINITIONS, ...props },
  });

beforeEach(() => {
  process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = "https://api.example/api/household-impact";
  clearHouseholdImpactCache();
  sessionStorage.clear();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL;
});

describe("the example cards' background figures", () => {
  it("are asked for when the file does not answer, the year chosen first, at most four at once", async () => {
    const api = deferredPost();
    const { result } = render({ post: api.post });
    // The first cell alone (it checks the measures), then up to four
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(result.current.pending.size).toBe(CELLS);
    await act(async () => api.answer(api.calls[0], 88));
    await waitFor(() => expect(api.calls).toHaveLength(1 + EXAMPLE_FILL_CONCURRENCY));
    expect(api.calls.slice(0, EXAMPLES.length).every((call) => call.body.year === YEAR)).toBe(true);
    expect(result.current.figures[EXAMPLES[0].id][YEAR]).toEqual({ change: 88, before: 20000, after: 20088 });
    // Never more than four out at once, to the end
    while (api.calls.some((call) => !call.done)) {
      const out = api.calls.filter((call) => !call.done);
      expect(out.length).toBeLessThanOrEqual(EXAMPLE_FILL_CONCURRENCY);
      await act(async () => api.answer(out[0]));
    }
    expect(api.calls).toHaveLength(CELLS);
    await waitFor(() => expect(result.current.pending.size).toBe(0));
    expect(Object.keys(result.current.figures[EXAMPLES[1].id]).map(Number).sort()).toEqual([...SELECTABLE_YEARS]);
  });

  it("asks nothing for what the session already has, and stores what it gets", async () => {
    const api = deferredPost();
    const first = render({ post: api.post });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    while (api.calls.some((call) => !call.done)) {
      await act(async () => api.answer(api.calls.find((call) => !call.done), 5));
    }
    await waitFor(() => expect(first.result.current.pending.size).toBe(0));
    first.unmount();
    const key = exampleKey(EXAMPLES[0].inputs, { year: YEAR, policies: POLICIES });
    expect(peekHouseholdImpact(key, null, approvedFor(POLICIES), POLICIES)?.net.change).toBe(5);
    expect(readStoredHeadline(key, null, approvedFor(POLICIES), POLICIES)?.net.change).toBe(5);
    // Again, from the session cache: no request
    const again = deferredPost();
    const second = render({ post: again.post });
    expect(second.result.current.figures[EXAMPLES[1].id][YEAR].change).toBe(5);
    second.unmount();
    // From sessionStorage alone (a new page in the same tab): no request
    clearHouseholdImpactCache();
    const third = render({ post: again.post });
    expect(third.result.current.figures[EXAMPLES[0].id][SELECTABLE_YEARS[2]].change).toBe(5);
    expect(third.result.current.pending.size).toBe(0);
    expect(again.calls).toHaveLength(0);
  });

  it("aborts what is out when the selection changes or the cards go, and drops late answers", async () => {
    const api = deferredPost();
    const { result, rerender, unmount } = render({ post: api.post });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    const old = api.calls[0];
    rerender({ examples: EXAMPLES, policies: ["road_fuel_vat_cut"], year: YEAR, enabled: true, expectedDefinitions: DEFINITIONS, post: api.post });
    expect(old.signal.aborted).toBe(true);
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1].body.policies).toEqual(["road_fuel_vat_cut"]);
    unmount();
    expect(api.calls[1].signal.aborted).toBe(true);
    expect(result.current.figures).toEqual({});
  });

  it("asks again without measures the API does not know, and says so", async () => {
    const api = deferredPost();
    const { result } = render({ post: api.post, policies: ["fuel_duty_rise_deferral", "mock_measure"] });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await act(async () =>
      api.calls[0].reject(
        new HouseholdApiError("invalid", "Value error, Unknown measures: mock_measure", {
          status: 422,
          fields: [{ field: "policies", label: "Policies", message: "Value error, Unknown measures: mock_measure" }],
        }),
      ),
    );
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1].body.policies).toEqual(["fuel_duty_rise_deferral"]);
    // The request asked again names only the measures it asks with
    expect(api.calls[1].definitions).toEqual(approvedFor(["fuel_duty_rise_deferral"]));
    await act(async () => api.answer(api.calls[1], 7));
    await waitFor(() => expect(result.current.figures[EXAMPLES[0].id]?.[YEAR]?.change).toBe(7));
    expect(result.current.reduced).toEqual(["fuel_duty_rise_deferral"]);
    expect(result.current.failed.size).toBe(0);
  });

  // Review of 79ae9c12, P2: the client gives this 422 as a
  // DefinitionMismatchError, which the fill must still read as unknown
  // measures, through the real client and with a detail URL, as the page
  // asks
  it("asks again without measures the running code does not register, from the API's own 422", async () => {
    process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = "https://detail.example/api/household-impact";
    const asked = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      asked.push({ url: String(url), policies: body.policies });
      const reply = body.policies.includes("mock_measure")
        ? {
            status: 422,
            value: {
              detail: [{ type: "value_error", loc: ["body", "policies"], msg: "Value error, Unknown measures: mock_measure", input: body.policies, ctx: { error: {} } }],
            },
          }
        : {
            status: 200,
            value: { year: body.year, net_income: { baseline: 100, reform: 107, change: 7 }, definitions: reportedDefinitions(url) },
          };
      return new Response(JSON.stringify(reply.value), { status: reply.status, headers: { "Content-Type": "application/json" } });
    });
    const post = (body, options) => postHouseholdDetail(body, { ...options, fetchImpl });
    try {
      const { result } = render({ post, policies: ["fuel_duty_rise_deferral", "mock_measure"] });
      await waitFor(() => expect(result.current.pending.size).toBe(0), { timeout: 5000 });
      expect(result.current.reduced).toEqual(["fuel_duty_rise_deferral"]);
      expect(result.current.failed.size).toBe(0);
      for (const example of EXAMPLES) {
        for (const y of SELECTABLE_YEARS) expect(result.current.figures[example.id][y].change).toBe(7);
      }
      // The first cell alone with the measure (the detail URL, then the main
      // API), then every cell without it, each from the detail URL
      const withIt = asked.filter((call) => call.policies.includes("mock_measure"));
      expect(withIt.map((call) => route(call.url))).toEqual([
        "https://detail.example/api/household-impact",
        "https://api.example/api/household-impact",
      ]);
      const without = asked.filter((call) => !call.policies.includes("mock_measure"));
      expect(without).toHaveLength(CELLS);
      for (const call of without) {
        expect(route(call.url)).toBe("https://detail.example/api/household-impact");
        expect(requestedDefinitions(call.url)).toEqual([["fuel_duty_rise_deferral", APPROVED_COMMIT]]);
      }
    } finally {
      delete process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL;
    }
  });

  it("asks nothing with no API, nothing selected, or while disabled", () => {
    const api = deferredPost();
    render({ post: api.post, enabled: false });
    render({ post: api.post, policies: [] });
    delete process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL;
    render({ post: api.post });
    expect(api.calls).toHaveLength(0);
  });
});

// #136: the cards' figures are checked as the calculator's own answers are
describe("the example cards' background figures, checked against the approved definitions", () => {
  const key = (y = YEAR, example = EXAMPLES[0], policies = POLICIES) => exampleKey(example.inputs, { year: y, policies });
  const nothingKept = (cell = key()) => {
    expect(peekHouseholdImpact(cell, null, approvedFor(POLICIES), POLICIES)).toBeNull();
    expect(sessionStorage.getItem(`ab2026:example-headline:v1:${cell}`)).toBeNull();
  };

  it("name each measure's approved definition in every request", async () => {
    const api = deferredPost();
    render({ post: api.post, policies: ["fuel_duty_rise_deferral", "road_fuel_vat_cut"] });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await act(async () => api.answer(api.calls[0]));
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(1));
    for (const call of api.calls) {
      expect(call.definitions).toEqual(approvedFor(["fuel_duty_rise_deferral", "road_fuel_vat_cut"]));
    }
  });

  it.each([
    ["reports no definitions (a build before PR 125)", NO_DEFINITIONS],
    ["reports none for the measure", {}],
    ["reports it at another commit", { fuel_duty_rise_deferral: { ...approvedDefinition(), git_sha: "e".repeat(40) } }],
    [
      "reports another reform",
      { fuel_duty_rise_deferral: { ...approvedDefinition(), reform: { ...approvedDefinition().reform, reform_sha256: "f".repeat(64) } } },
    ],
    ["cannot bind it", { fuel_duty_rise_deferral: { error: "no such reform" } }],
  ])("show no figure from an answer that %s, and keep nothing of it", async (_why, reported) => {
    const api = deferredPost();
    const { result } = render({ post: api.post });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await act(async () => api.answer(api.calls[0], 88, reported));
    await waitFor(() => expect(result.current.failed.has(`${EXAMPLES[0].id}:${YEAR}`)).toBe(true));
    expect(result.current.figures[EXAMPLES[0].id]?.[YEAR]).toBeUndefined();
    nothingKept();
  });

  it("refuse an answer from other package versions as before", async () => {
    const api = deferredPost();
    const expectedEngine = { "policyengine-uk": "2.0.0" };
    const { result } = render({ post: api.post, expectedEngine });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await act(async () => {
      api.calls[0].done = true;
      api.calls[0].resolve({
        net_income: { baseline: 1, reform: 2, change: 1 },
        engine: { "policyengine-uk": "1.0.0" },
        definitions: api.calls[0].definitions,
      });
    });
    await waitFor(() => expect(result.current.failed.size).toBe(1));
    expect(result.current.figures).toEqual({});
  });

  it("use no headline kept without the approved definitions: the session's, or one stored before them", async () => {
    // A headline stored by a page before #136 (net income and engine only)
    sessionStorage.setItem(
      `ab2026:example-headline:v1:${key()}`,
      JSON.stringify({ net: { change: 3, before: 1, after: 4 }, engine: null }),
    );
    expect(readStoredHeadline(key(), null, approvedFor(POLICIES), POLICIES)).toBeNull();
    const api = deferredPost();
    const { result } = render({ post: api.post });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    // Asked again, the year chosen and the first example first
    expect(api.calls[0].body.year).toBe(YEAR);
    expect(result.current.figures[EXAMPLES[0].id]?.[YEAR]).toBeUndefined();
    // One stored with them is used, but only for the measures it was asked with
    sessionStorage.setItem(
      `ab2026:example-headline:v1:${key()}`,
      JSON.stringify({ net: { change: 3, before: 1, after: 4 }, engine: null, definitions: approvedFor(POLICIES) }),
    );
    expect(readStoredHeadline(key(), null, approvedFor(POLICIES), POLICIES)?.net.change).toBe(3);
    expect(readStoredHeadline(key(), null, approvedFor(POLICIES), [...POLICIES, "road_fuel_vat_cut"])).toBeNull();
    expect(readStoredHeadline(key(), null, approvedFor(POLICIES), [])).toBeNull();
    expect(readStoredHeadline(key(), null, {}, POLICIES)).toBeNull();
  });

  it("use the calculator's own answer for a card only when it reports the approved definitions", async () => {
    // Answers the calculator has in the session cache (not in sessionStorage):
    // the first example's with the definitions, the second's without
    const answer = (change, definitions) =>
      normaliseHouseholdImpact({ net_income: { baseline: 1, reform: 1 + change, change }, ...(definitions ? { definitions } : {}) });
    seedHouseholdImpactCache([
      [key(YEAR, EXAMPLES[0]), answer(6, approvedFor(POLICIES))],
      [key(YEAR, EXAMPLES[1]), answer(9, null)],
    ]);
    const api = deferredPost();
    const { result } = render({ post: api.post });
    expect(result.current.figures[EXAMPLES[0].id][YEAR].change).toBe(6);
    expect(result.current.figures[EXAMPLES[1].id]?.[YEAR]).toBeUndefined();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    // The unchecked one is asked again, first
    expect(api.calls[0].body.year).toBe(YEAR);
    expect(api.calls[0].body.household).toEqual(buildHouseholdRequest(EXAMPLES[1].inputs, { year: YEAR, policies: POLICIES }).household);
  });

  it("start again when a measure's approved definition changes, under the new one", async () => {
    const api = deferredPost();
    const { rerender } = render({ post: api.post });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    const later = { ...DEFINITIONS, fuel_duty_rise_deferral: { ...approvedDefinition(), git_sha: "a".repeat(40) } };
    rerender({ examples: EXAMPLES, policies: POLICIES, year: YEAR, enabled: true, expectedDefinitions: later, post: api.post });
    expect(api.calls[0].signal.aborted).toBe(true);
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1].definitions).toEqual({ fuel_duty_rise_deferral: later.fuel_duty_rise_deferral });
  });

  it("ask nothing while a selected measure has no approved definition", () => {
    const api = deferredPost();
    const { result } = render({ post: api.post, policies: ["fuel_duty_rise_deferral", "unapproved"] });
    render({ post: api.post, expectedDefinitions: null });
    expect(api.calls).toHaveLength(0);
    expect(result.current.figures).toEqual({});
    expect(result.current.pending.size).toBe(0);
  });

  it("take the detail URL's answer only when it reports the approved definitions, else ask the main API", async () => {
    process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = "https://detail.example/api/household-impact";
    const answered = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        answered.push(String(url));
        const body = JSON.parse(init.body);
        const fromDetail = route(url).startsWith("https://detail.example");
        const reported = Object.fromEntries(
          requestedDefinitions(url).map(([id, gitSha]) => [id, { ...approvedDefinition(), git_sha: gitSha }]),
        );
        return new Response(
          JSON.stringify({
            year: body.year,
            net_income: { baseline: 100, reform: fromDetail ? 999 : 142, change: fromDetail ? 899 : 42 },
            // The detail service runs older code: it reports none
            ...(fromDetail ? {} : { definitions: reported }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    try {
      const { result } = render({ examples: EXAMPLES.slice(0, 1) });
      await waitFor(() => expect(result.current.pending.size).toBe(0), { timeout: 5000 });
      // Each cell asked of the detail URL, then of the main API
      expect(answered.filter((url) => url.startsWith("https://detail.example"))).toHaveLength(SELECTABLE_YEARS.length);
      expect(answered.filter((url) => url.startsWith("https://api.example"))).toHaveLength(SELECTABLE_YEARS.length);
      for (const url of answered) expect(requestedDefinitions(url)).toEqual([["fuel_duty_rise_deferral", APPROVED_COMMIT]]);
      // The main API's figure, never the detail service's
      for (const y of SELECTABLE_YEARS) expect(result.current.figures[EXAMPLES[0].id][y].change).toBe(42);
      expect(result.current.failed.size).toBe(0);
    } finally {
      delete process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL;
      vi.unstubAllGlobals();
    }
  });

  it("show a figure if and only if its answer computes every measure asked with from its approved definition", async () => {
    const MEASURES = ["fuel_duty_rise_deferral", "road_fuel_vat_cut", "mock_measure"];
    const REPORTS = {
      same: (definition) => definition,
      commit: (definition) => ({ ...definition, git_sha: "e".repeat(40) }),
      baseline: (definition) => ({ ...definition, baseline: { ...definition.baseline, kind: "reform" } }),
      error: () => ({ error: "unbound" }),
    };
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(MEASURES, { minLength: 1 }),
        fc.dictionary(fc.constantFrom(...MEASURES), fc.constantFrom(...Object.keys(REPORTS), "missing")),
        fc.boolean(),
        async (policies, reports, reportsAny) => {
          clearHouseholdImpactCache();
          sessionStorage.clear();
          const post = async (body, { definitions }) => ({
            year: body.year,
            net_income: { baseline: 10, reform: 15, change: 5 },
            ...(reportsAny
              ? {
                  definitions: Object.fromEntries(
                    Object.entries(definitions)
                      .filter(([id]) => (reports[id] ?? "same") !== "missing")
                      .map(([id, definition]) => [id, REPORTS[reports[id] ?? "same"](definition)]),
                  ),
                }
              : {}),
          });
          const { result, unmount } = render({ post, policies, examples: EXAMPLES.slice(0, 1) });
          await waitFor(() => expect(result.current.pending.size).toBe(0));
          const shown = reportsAny && policies.every((id) => (reports[id] ?? "same") === "same");
          for (const y of SELECTABLE_YEARS) {
            const cell = exampleKey(EXAMPLES[0].inputs, { year: y, policies });
            expect(result.current.figures[EXAMPLES[0].id]?.[y]?.change ?? null).toBe(shown ? 5 : null);
            expect(result.current.failed.has(`${EXAMPLES[0].id}:${y}`)).toBe(!shown);
            // Kept for the calculator and the next visit only when shown
            expect(Boolean(peekHouseholdImpact(cell, null, approvedFor(policies), policies))).toBe(shown);
            expect(Boolean(readStoredHeadline(cell, null, approvedFor(policies), policies))).toBe(shown);
          }
          unmount();
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("the fill's helpers", () => {
  it("runLimited never has more than its limit out, and starts nothing once aborted", async () => {
    let out = 0;
    let most = 0;
    const controller = new AbortController();
    let started = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started += 1;
      out += 1;
      most = Math.max(most, out);
      await new Promise((resolve) => setTimeout(resolve, 1));
      out -= 1;
      if (i === 5) controller.abort();
    });
    await runLimited(tasks, 3, controller.signal);
    expect(most).toBe(3);
    expect(started).toBeLessThan(10);
  });

  it("unknownMeasures reads the API's refusal, and nothing else", () => {
    expect(unknownMeasures({ message: "x", fields: [{ message: "Value error, Unknown measures: a_b, c" }] })).toEqual(["a_b", "c"]);
    expect(unknownMeasures(new Error("timeout"))).toBeNull();
    // The client's form of the same 422
    const unregistered = (id) => ({ id, problems: [UNREGISTERED_PROBLEM] });
    expect(unknownMeasures(new DefinitionMismatchError([unregistered("a_b"), unregistered("c")]))).toEqual(["a_b", "c"]);
    // A definition that differs is a refusal, never an unknown measure
    const differs = { id: "c", problems: ["git_sha: approved cccc, reported eeee"] };
    expect(unknownMeasures(new DefinitionMismatchError([differs]))).toBeNull();
    expect(unknownMeasures(new DefinitionMismatchError([unregistered("a_b"), differs]))).toBeNull();
    expect(unknownMeasures(new DefinitionMismatchError([{ id: "a_b", problems: [UNREGISTERED_PROBLEM, "git_sha: other"] }]))).toBeNull();
    expect(unknownMeasures(new DefinitionMismatchError([{ id: "a_b", problems: [] }]))).toBeNull();
    expect(unknownMeasures(new DefinitionMismatchError([unregistered("a_b")], { unchecked: true }))).toBeNull();
    expect(unknownMeasures(new DefinitionMismatchError([]))).toBeNull();
  });

  it("unknownMeasures drops a measure only when every refusal says the running code does not register it", () => {
    const problem = fc.oneof(
      fc.constant(UNREGISTERED_PROBLEM),
      fc.constant("git_sha: approved cccc, reported eeee"),
      fc.constant("the running code cannot bind it: refused"),
      fc.constant("the running code cannot bind it: no reason given"),
    );
    const item = fc.record({ id: fc.constantFrom("a", "b", "c"), problems: fc.array(problem, { maxLength: 3 }) });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 4 }), fc.boolean(), (refused, unchecked) => {
        const ids = unknownMeasures(new DefinitionMismatchError(refused, { unchecked }));
        const everyUnregistered =
          refused.length > 0 && refused.every((r) => r.problems.length > 0 && r.problems.every((p) => p === UNREGISTERED_PROBLEM));
        expect(ids).toEqual(!unchecked && everyUnregistered ? refused.map((r) => r.id) : null);
      }),
      { numRuns: 300 },
    );
  });
});

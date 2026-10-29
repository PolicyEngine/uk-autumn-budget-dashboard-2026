import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useExampleFigures, { EXAMPLE_FILL_CONCURRENCY, exampleKey, readStoredHeadline, runLimited, unknownMeasures } from "./useExampleFigures";
import { clearHouseholdImpactCache, peekHouseholdImpact } from "./useHouseholdImpact";
import { HouseholdApiError } from "../utils/householdImpactApi";
import { SELECTABLE_YEARS } from "../utils/displayYears";
import { HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";
import { presetInputs } from "../utils/householdPresets";

const EXAMPLES = HOUSEHOLD_EXAMPLES.slice(0, 2).map((example) => ({ id: example.id, inputs: presetInputs(example) }));
const POLICIES = ["fuel_duty_rise_deferral"];
const YEAR = SELECTABLE_YEARS[0];
const CELLS = EXAMPLES.length * SELECTABLE_YEARS.length;

// A request the test answers when it chooses: every call is kept, with its
// body, signal and how to answer it
function deferredPost() {
  const calls = [];
  const post = (body, { signal }) =>
    new Promise((resolve, reject) => {
      const call = { body, signal, resolve, reject, done: false };
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      calls.push(call);
    });
  const answer = (call, change = 10) => {
    call.done = true;
    call.resolve({ year: call.body.year, net_income: { baseline: 20000, reform: 20000 + change, change } });
  };
  return { post, calls, answer };
}

const render = (props) =>
  renderHook((p) => useExampleFigures(p), {
    initialProps: { examples: EXAMPLES, policies: POLICIES, year: YEAR, enabled: true, ...props },
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
    // Asked, and keyed, with the measures the calculator always adds
    const key = exampleKey(EXAMPLES[0].inputs, {
      year: YEAR,
      policies: [...POLICIES, "savings_income_rates_up", "gas_standing_charges_abolition"],
    });
    expect(peekHouseholdImpact(key)?.net.change).toBe(5);
    expect(readStoredHeadline(key)?.net.change).toBe(5);
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
    rerender({ examples: EXAMPLES, policies: ["road_fuel_vat_cut"], year: YEAR, enabled: true, post: api.post });
    expect(old.signal.aborted).toBe(true);
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1].body.policies).toEqual(["road_fuel_vat_cut", "savings_income_rates_up", "gas_standing_charges_abolition"]);
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
    expect(api.calls[1].body.policies).toEqual(["fuel_duty_rise_deferral", "savings_income_rates_up", "gas_standing_charges_abolition"]);
    await act(async () => api.answer(api.calls[1], 7));
    await waitFor(() => expect(result.current.figures[EXAMPLES[0].id]?.[YEAR]?.change).toBe(7));
    expect(result.current.reduced).toEqual(["fuel_duty_rise_deferral"]);
    expect(result.current.failed.size).toBe(0);
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
  });
});

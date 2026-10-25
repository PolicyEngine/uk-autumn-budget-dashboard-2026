import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { serialisedChecks } from "./check";

// Review of 428d209, finding 2: a focus during a check in flight was
// dropped, and a request could be answered on a check that predated it.
describe("serialised publication checks", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };

  it("queues one further check for every call made during a check", async () => {
    const runs = [];
    const check = serialisedChecks(() => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    });
    const first = check();
    const during = [check(), check(), check()];
    expect(runs).toHaveLength(1);
    runs[0].resolve("one");
    expect(await first).toBe("one");
    await Promise.resolve();
    expect(runs).toHaveLength(2);
    runs[1].resolve("two");
    // Each call made during the first check gets the second one's result
    expect(await Promise.all(during)).toEqual(["two", "two", "two"]);
    expect(runs).toHaveLength(2);
    // Idle again: the next call starts a check at once
    const later = check();
    expect(runs).toHaveLength(3);
    runs[2].resolve("three");
    expect(await later).toBe("three");
  });

  it("answers every call with a check that started after it", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.nat(3), { minLength: 1, maxLength: 12 }), async (pattern) => {
      // Each step makes a call, then lets `ticks` checks finish
      let started = 0;
      const pending = [];
      const check = serialisedChecks(() => {
        const run = deferred();
        const index = (started += 1);
        pending.push(() => run.resolve(index));
        return run.promise;
      });
      const calls = [];
      for (const ticks of pattern) {
        calls.push({ startedBefore: started, answer: check() });
        for (let tick = 0; tick < ticks && pending.length; tick += 1) {
          pending.shift()();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      while (pending.length) {
        pending.shift()();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (const call of calls) expect(await call.answer).toBeGreaterThan(call.startedBefore);
    }), { numRuns: 60 });
  });
});

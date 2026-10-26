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

  it("answers every call with a check that started after it, one at a time", async () => {
    // Each step makes a call, then lets `ticks` checks finish; a check whose
    // `fails` flag is set rejects (review of 15439f4, finding 7)
    const step = fc.record({ ticks: fc.nat(3), fails: fc.boolean() });
    await fc.assert(fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (pattern) => {
      let started = 0;
      let active = 0;
      let mostActive = 0;
      const pending = [];
      const check = serialisedChecks(() => {
        const index = (started += 1);
        active += 1;
        mostActive = Math.max(mostActive, active);
        const fails = pattern[(index - 1) % pattern.length].fails;
        return new Promise((resolve, reject) => {
          pending.push(() => {
            active -= 1;
            if (fails) reject(Object.assign(new Error("check failed"), { index }));
            else resolve(index);
          });
        });
      });
      const answerOf = (promise) => promise.then((index) => index, (error) => error.index);
      const calls = [];
      for (const { ticks } of pattern) {
        calls.push({ startedBefore: started, answer: answerOf(check()) });
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
      expect(mostActive).toBe(1);
    }), { numRuns: 100 });
  });

  it("starts the queued check after one that rejects, and answers later calls afresh", async () => {
    const runs = [];
    const check = serialisedChecks(() => {
      const run = {};
      run.promise = new Promise((resolve, reject) => Object.assign(run, { resolve, reject }));
      runs.push(run);
      return run.promise;
    });
    const first = check();
    const during = check();
    runs[0].reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    await Promise.resolve();
    expect(runs).toHaveLength(2);
    runs[1].resolve("two");
    expect(await during).toBe("two");
    // A later call during a check queues a new one, not the old rejection
    const third = check();
    const duringThird = check();
    expect(runs).toHaveLength(3);
    runs[2].resolve("three");
    expect(await third).toBe("three");
    await Promise.resolve();
    expect(runs).toHaveLength(4);
    runs[3].resolve("four");
    expect(await duringThird).toBe("four");
  });

  it("treats a run that throws like one that rejects", async () => {
    let calls = 0;
    const check = serialisedChecks(() => {
      calls += 1;
      if (calls === 1) throw new Error("bad state");
      return Promise.resolve(calls);
    });
    await expect(check()).rejects.toThrow("bad state");
    expect(await check()).toBe(2);
  });
});

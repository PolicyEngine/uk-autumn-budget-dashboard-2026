import { createContext, useContext } from "react";

/**
 * The page's check of the live publication, for a request that must not
 * outrun it: `confirm(snapshot)` resolves once a manifest check that started
 * after the call has finished, true when the live manifest is still that
 * snapshot. App provides it; with no provider there is nothing to check
 * against and it is absent.
 */
export const PublicationCheckContext = createContext(null);

export const usePublicationCheck = () => useContext(PublicationCheckContext);

/**
 * Serialise `run` (one check of the live publication, resolving to what it
 * found): one runs at a time, and a call during a run queues exactly one
 * further run, which starts when that one ends. So every call resolves with
 * the result of a run that started after the call, and a trigger mid-check
 * (a focus, say) is never lost. A run that rejects, or throws, rejects the
 * calls it answers; the queued run still starts after it.
 *
 * @param {() => Promise<any>} run
 * @returns {() => Promise<any>}
 */
export function serialisedChecks(run) {
  let running = null;
  let queued = null;
  const next = () => {
    queued = null;
    return check();
  };
  const check = () => {
    if (running) {
      queued ??= running.then(next, next);
      return queued;
    }
    running = new Promise((resolve) => resolve(run())).finally(() => {
      running = null;
    });
    return running;
  };
  return check;
}

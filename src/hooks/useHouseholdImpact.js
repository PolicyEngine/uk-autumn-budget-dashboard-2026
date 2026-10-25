import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DETAIL_PARTS,
  DETAIL_TIMEOUT_MS,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  engineDifferences,
  mergeStages,
  normaliseHouseholdImpact,
  postHouseholdDetail,
  postHouseholdImpact,
  requestKey,
} from "../utils/householdImpactApi";

// Results already fetched this session, by request: switching the year or
// the policies back shows them at once
const cache = new Map();

/** Empty the session cache (for tests). */
export function clearHouseholdImpactCache() {
  cache.clear();
}

// Wait this long after the last change before asking
const DEBOUNCE_MS = 400;

/**
 * The Household impact results for the wizard's answers: the headline and
 * programmes first, then the earnings sweep and the per-policy split, asked
 * for at once and each shown as it arrives.
 *
 * @param {Object} params
 * @param {Object} params.inputs - The wizard's answers
 * @param {number} params.year - The policy year (2029 is 2029-30)
 * @param {string[]} params.policies - Selected measure ids
 * @param {boolean} params.enabled - Ask only while the view is shown
 * @param {string} [params.publicationKey] - The publication snapshot shown
 * @param {Object<string, string>} [params.expectedEngine] - The package
 *   versions the selected measures' receipts record; an answer from others
 *   is refused, and is an error
 * @param {(snapshot: string) => Promise<boolean>} [params.confirmPublication]
 *   - Resolves after a check of the live publication that started after it
 *   was called; each request waits for it and is dropped unless still current
 * @returns {{ status: "idle"|"loading"|"ready"|"error", data: Object|null,
 *   error: Error|null, detailStatus: "idle"|"loading"|"ready"|"error",
 *   detailError: Error|null, retry: () => void }}
 */
export default function useHouseholdImpact({ inputs, year, policies, enabled, publicationKey = "", expectedEngine = null, confirmPublication = null }) {
  const body = useMemo(
    () => buildHouseholdRequest(inputs, { year, policies }),
    [inputs, year, policies],
  );
  const key = `${publicationKey}:${requestKey(body)}`;
  const [attempt, setAttempt] = useState(0);
  // `key` is the request asked for last; `dataKey` the request `data`
  // answers. They differ while a new answer loads: the old numbers are then
  // stale, however many renders that takes.
  const [state, setState] = useState({
    key: null,
    dataKey: null,
    status: "idle",
    data: null,
    error: null,
    detailStatus: "idle",
    detailError: null,
  });

  useEffect(() => {
    if (!enabled || policies.length === 0) return undefined;
    const cached = cache.get(key);
    if (cached?.complete) {
      setState({
        key,
        dataKey: key,
        status: "ready",
        data: cached.data,
        error: null,
        detailStatus: "ready",
        detailError: null,
      });
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    // Keep the last result on screen while the next one loads; it stays
    // marked stale (dataKey) until this request's answer arrives
    setState((prev) => ({
      ...prev,
      key,
      dataKey: cached ? key : prev.dataKey,
      status: cached ? "ready" : "loading",
      data: cached ? cached.data : prev.data,
      error: null,
      detailStatus: "loading",
      detailError: null,
    }));
    // Each request waits for a check of the live publication made after it,
    // and is dropped if the snapshot it was made under is no longer live:
    // the page then shows the new snapshot's views, or none.
    const current = async () => !confirmPublication || (await confirmPublication(publicationKey));
    const refuse = (error) => {
      cache.delete(key);
      setState({ key, dataKey: null, status: "error", data: null, error, detailStatus: "idle", detailError: null });
    };
    const timer = setTimeout(async () => {
      let first = cached?.data ?? null;
      if (!first) {
        try {
          if (!(await current()) || signal.aborted) return;
          const raw = await postHouseholdImpact(
            { ...body, include: HEADLINE_INCLUDE },
            { signal },
          );
          first = normaliseHouseholdImpact(raw);
        } catch (error) {
          if (signal.aborted) return;
          setState({
            key,
            dataKey: null,
            status: "error",
            data: null,
            error,
            detailStatus: "idle",
            detailError: null,
          });
          return;
        }
        if (signal.aborted) return;
        // Answered by other package versions than the published figures
        const differ = expectedEngine ? engineDifferences(expectedEngine, first.engine) : [];
        if (differ.length) {
          refuse(new EngineMismatchError(differ));
          return;
        }
        const complete = first.byPolicy !== null && first.sweep !== null;
        cache.set(key, { data: first, complete });
        setState({
          key,
          dataKey: key,
          status: "ready",
          data: first,
          error: null,
          detailStatus: complete ? "ready" : "loading",
          detailError: null,
        });
        if (complete) return;
      }
      // The sweep and the split by policy, asked for at once: each part is
      // shown as soon as its own answer arrives
      let merged = first;
      let failure = null;
      let refused = null;
      const parts = DETAIL_PARTS.filter((include) =>
        include.some((part) => (part === "sweep" ? merged.sweep : merged.byPolicy) === null),
      );
      await Promise.all(
        parts.map(async (include) => {
          try {
            if (!(await current()) || signal.aborted || refused) return;
            const raw = await postHouseholdDetail(
              { ...body, include },
              { signal, timeoutMs: DETAIL_TIMEOUT_MS },
            );
            if (signal.aborted || refused) return;
            // Refused unless from the headline's own package versions
            merged = mergeStages(merged, normaliseHouseholdImpact(raw));
            const complete = merged.byPolicy !== null && merged.sweep !== null;
            cache.set(key, { data: merged, complete });
            setState((prev) => ({
              ...prev,
              key,
              dataKey: key,
              status: "ready",
              data: merged,
              error: null,
              detailStatus: complete ? "ready" : prev.detailStatus,
            }));
          } catch (error) {
            if (signal.aborted) return;
            if (error instanceof EngineMismatchError) refused = refused ?? error;
            else failure = failure ?? error;
          }
        }),
      );
      if (signal.aborted) return;
      if (refused) {
        refuse(refused);
        return;
      }
      if (!failure) return;
      setState((prev) => ({ ...prev, detailStatus: "error", detailError: failure }));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // body is derived from key's inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt, policies.length]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // `stale`: the data on screen answers other inputs (an earlier year or
  // set of policies) than the ones now chosen, from the moment they change
  // until the new answer arrives. The page greys it and labels it with its
  // own year, never the new one.
  const asked = state.key === key;
  const stale = state.data !== null && state.dataKey !== key;
  return {
    status: asked ? state.status : "loading",
    data: state.data,
    error: asked ? state.error : null,
    detailStatus: asked ? state.detailStatus : "loading",
    detailError: asked ? state.detailError : null,
    stale,
    retry,
  };
}

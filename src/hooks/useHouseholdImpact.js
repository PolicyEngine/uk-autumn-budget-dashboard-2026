import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DETAIL_PARTS,
  DETAIL_TIMEOUT_MS,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  mergeStages,
  normaliseHouseholdImpact,
  postHouseholdDetail,
  postHouseholdImpact,
  requestKey,
} from "../utils/householdImpactApi";

// Results already fetched this session, by request: switching the year or
// the policies back shows them at once
const cache = new Map();

/**
 * A result already in the session cache for a request key (fetched, or a
 * precomputed example), or null. Its headline may be all it has.
 */
export function peekHouseholdImpact(key) {
  return cache.get(key)?.data ?? null;
}

/** Remember a headline answer (its detail parts are null) for a key. */
export function rememberHouseholdHeadline(key, data) {
  if (!cache.has(key)) cache.set(key, { data, complete: false });
}

/** Empty the session cache (for tests). */
export function clearHouseholdImpactCache() {
  cache.clear();
}

/**
 * Add complete answers to the session cache, as [requestKey, result]
 * pairs: the precomputed examples (utils/householdPresets.js), shown at
 * once when asked for. An answer already fetched is kept.
 */
export function seedHouseholdImpactCache(entries) {
  for (const [key, data] of entries) {
    if (!cache.get(key)?.complete) cache.set(key, { data, complete: true });
  }
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
 * @param {number} [params.seeded] - Bumped when answers are added to the
 *   cache, so a request still waiting picks up a precomputed answer
 * @param {string|null} [params.household] - Which household the answers
 *   are (an example's id, or "yours"): a result is never shown for another
 *   household, even while the new one loads
 * @returns {{ status: "idle"|"loading"|"ready"|"error", data: Object|null,
 *   error: Error|null, detailStatus: "idle"|"loading"|"ready"|"error",
 *   detailError: Error|null, retry: () => void }}
 */
export default function useHouseholdImpact({ inputs, year, policies, enabled, seeded = 0, household = null }) {
  const body = useMemo(
    () => buildHouseholdRequest(inputs, { year, policies }),
    [inputs, year, policies],
  );
  const key = requestKey(body);
  const [attempt, setAttempt] = useState(0);
  // `key` is the request asked for last; `dataKey` the request `data`
  // answers. They differ while a new answer loads: the old numbers are then
  // stale, however many renders that takes. `dataHousehold` is whose
  // answers `data` is: another household's is never returned.
  const [state, setState] = useState({
    key: null,
    dataKey: null,
    dataHousehold: null,
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
        dataHousehold: household,
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
    // The same household asked again (another year or set of policies):
    // keep its last result on screen while the next one loads, marked stale
    // (dataKey) until this request's answer arrives, as the guide's "don't
    // clear results before new data arrives" asks. Another household (a
    // different card) never keeps it: `shown` below hides it at once, and
    // a late answer for the earlier request is dropped (its signal is
    // aborted below, and every update checks it)
    setState((prev) => ({
      ...prev,
      key,
      dataKey: cached ? key : prev.dataKey,
      dataHousehold: cached ? household : prev.dataHousehold,
      status: cached ? "ready" : "loading",
      data: cached ? cached.data : prev.data,
      error: null,
      detailStatus: "loading",
      detailError: null,
    }));
    const timer = setTimeout(async () => {
      let first = cached?.data ?? null;
      if (!first) {
        try {
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
            dataHousehold: null,
            status: "error",
            data: null,
            error,
            detailStatus: "idle",
            detailError: null,
          });
          return;
        }
        if (signal.aborted) return;
        const complete = first.byPolicy !== null && first.sweep !== null;
        cache.set(key, { data: first, complete });
        setState({
          key,
          dataKey: key,
          dataHousehold: household,
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
      const parts = DETAIL_PARTS.filter((include) =>
        include.some((part) => (part === "sweep" ? merged.sweep : merged.byPolicy) === null),
      );
      await Promise.all(
        parts.map(async (include) => {
          try {
            const raw = await postHouseholdDetail(
              { ...body, include },
              { signal, timeoutMs: DETAIL_TIMEOUT_MS },
            );
            if (signal.aborted) return;
            merged = mergeStages(merged, normaliseHouseholdImpact(raw));
            const complete = merged.byPolicy !== null && merged.sweep !== null;
            cache.set(key, { data: merged, complete });
            setState((prev) => ({
              ...prev,
              key,
              dataKey: key,
              dataHousehold: household,
              status: "ready",
              data: merged,
              error: null,
              detailStatus: complete ? "ready" : prev.detailStatus,
            }));
          } catch (error) {
            if (signal.aborted) return;
            failure = failure ?? error;
          }
        }),
      );
      if (signal.aborted || !failure) return;
      setState((prev) => ({ ...prev, detailStatus: "error", detailError: failure }));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // body is derived from key's inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, household, enabled, attempt, policies.length, seeded]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // `stale`: the data on screen answers other inputs (an earlier year or
  // set of policies) than the ones now chosen, from the moment they change
  // until the new answer arrives. The page greys it and labels it with its
  // own year, never the new one.
  const asked = state.key === key;
  // The data is for this household (another card's result is never shown
  // as this one's, not even greyed while this one loads)
  const shown = state.data !== null && state.dataHousehold === household ? state.data : null;
  const stale = shown !== null && state.dataKey !== key;
  return {
    status: asked ? state.status : "loading",
    data: shown,
    error: asked ? state.error : null,
    detailStatus: asked ? state.detailStatus : "loading",
    detailError: asked ? state.detailError : null,
    stale,
    retry,
  };
}

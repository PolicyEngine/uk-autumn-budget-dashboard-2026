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
  stageMismatch,
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
 * Add complete answers to the session cache, as [key, result] pairs (the
 * key as this hook builds it: publication snapshot, then request)
 * : the precomputed examples (utils/householdPresets.js), shown at
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
 * @param {string} [params.publicationKey] - The publication snapshot shown
 * @param {Object<string, string>} [params.expectedEngine] - The package
 *   versions the selected measures' receipts record; an answer from others
 *   is refused, and is an error
 * @param {(snapshot: string) => Promise<boolean>} [params.confirmPublication]
 *   - Resolves after a check of the live publication that started after it
 *   was called; each request waits for it and is dropped unless still current
 * @param {number} [params.seeded] - Bumped when answers are added to the
 *   cache, so a request still waiting picks up a precomputed answer
 * @param {string|null} [params.household] - Which household the answers
 *   are (an example's id, or "yours"): a result is never shown for another
 *   household, even while the new one loads
 * @returns {{ status: "idle"|"loading"|"ready"|"error", data: Object|null,
 *   error: Error|null, detailStatus: "idle"|"loading"|"ready"|"error",
 *   detailError: Error|null, retry: () => void }}
 */
export default function useHouseholdImpact({ inputs, year, policies, enabled, publicationKey = "", expectedEngine = null, confirmPublication = null, seeded = 0, household = null }) {
  const body = useMemo(
    () => buildHouseholdRequest(inputs, { year, policies }),
    [inputs, year, policies],
  );
  const key = `${publicationKey}:${requestKey(body)}`;
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
    // Each request waits for a check of the live publication made after it,
    // and is dropped if the snapshot it was made under is no longer live:
    // the page then shows the new snapshot's views, or none.
    const current = async () => !confirmPublication || (await confirmPublication(publicationKey));
    const refuse = (error) => {
      cache.delete(key);
      setState({ key, dataKey: null, dataHousehold: null, status: "error", data: null, error, detailStatus: "idle", detailError: null });
      // Nothing else this request asked for can be shown now
      controller.abort();
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
      // shown as soon as its own answer arrives. They wait for a check of the
      // live publication, and a part answered by other package versions than
      // the headline's refuses the whole result.
      if (!(await current()) || signal.aborted) return;
      let merged = first;
      let failure = null;
      let refused = false;
      const parts = DETAIL_PARTS.filter((include) =>
        include.some((part) => (part === "sweep" ? merged.sweep : merged.byPolicy) === null),
      );
      // The detail service's answer is used only if it has the part asked
      // for, reports the headline's build commit and matches it; otherwise
      // the part is asked of the main API
      const acceptFor = (include) => (raw) => {
        try {
          const detail = normaliseHouseholdImpact(raw);
          const answered = include.every((part) => (part === "sweep" ? detail.sweep : detail.byPolicy) !== null);
          return answered && stageMismatch(first, detail, { sameBuild: true }) === null;
        } catch {
          return false;
        }
      };
      await Promise.all(
        parts.map(async (include) => {
          try {
            const raw = await postHouseholdDetail(
              { ...body, include },
              { signal, timeoutMs: DETAIL_TIMEOUT_MS, accept: acceptFor(include) },
            );
            if (signal.aborted || refused) return;
            // Refused unless from the headline's own package versions and,
            // where both report one, its build commit
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
            if (signal.aborted || refused) return;
            if (error instanceof EngineMismatchError) {
              refused = true;
              refuse(error);
              return;
            }
            failure = failure ?? error;
          }
        }),
      );
      if (signal.aborted || refused) return;
      // An answer without the part it was asked for leaves the result
      // incomplete: say so rather than wait for good
      const incomplete = merged.byPolicy === null || merged.sweep === null;
      if (!failure && !incomplete) return;
      setState((prev) => ({
        ...prev,
        detailStatus: "error",
        detailError: failure ?? new Error("The household calculator's breakdown came back incomplete"),
      }));
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

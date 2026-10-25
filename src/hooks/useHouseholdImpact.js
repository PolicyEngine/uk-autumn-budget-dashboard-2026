import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DETAIL_INCLUDE,
  DETAIL_TIMEOUT_MS,
  DefinitionMismatchError,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  definitionRefusals,
  engineDifferences,
  mergeStages,
  normaliseHouseholdImpact,
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
 * The Personal impact results for the wizard's answers, in two stages: the
 * headline and programmes, then the per-policy split and earnings sweep.
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
 * @param {Object<string, Object>} [params.expectedDefinitions] - Each
 *   selected measure's approved definition (`publishedDefinitions`). Both
 *   stages name their commits, and an answer whose reported definitions
 *   differ, or that reports none, is refused: a DefinitionMismatchError
 *   naming the measures. A selected measure with none here is refused
 *   before any request, so leaving it out never shows an unchecked answer
 * @param {(snapshot: string) => Promise<boolean>} [params.confirmPublication]
 *   - Resolves after a check of the live publication that started after it
 *   was called; each request waits for it and is dropped unless still current
 * @returns {{ status: "idle"|"loading"|"ready"|"error", data: Object|null,
 *   error: Error|null, detailStatus: "idle"|"loading"|"ready"|"error",
 *   detailError: Error|null, retry: () => void }}
 */
export default function useHouseholdImpact({ inputs, year, policies, enabled, publicationKey = "", expectedEngine = null, expectedDefinitions = null, confirmPublication = null }) {
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
    const refuse = (error) => {
      cache.delete(key);
      setState({ key, dataKey: null, status: "error", data: null, error, detailStatus: "idle", detailError: null });
    };
    // Nothing is answered unchecked: a selected measure with no approved
    // definition is refused before any request
    const unapproved = policies.filter((id) => !Object.hasOwn(expectedDefinitions ?? {}, id));
    if (unapproved.length) {
      refuse(new DefinitionMismatchError(definitionRefusals(expectedDefinitions, null, unapproved)));
      return undefined;
    }
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
    // The refusal of the selected measures the API's code does not compute
    // from their approved definitions, or null when it computes them all
    const mismatch = (answer) => {
      const refused = definitionRefusals(expectedDefinitions, answer.definitions, policies);
      return refused.length ? new DefinitionMismatchError(refused, { unchecked: answer.definitions === null }) : null;
    };
    const definitions = expectedDefinitions;
    const timer = setTimeout(async () => {
      let first = cached?.data ?? null;
      if (!first) {
        try {
          if (!(await current()) || signal.aborted) return;
          const raw = await postHouseholdImpact(
            { ...body, include: HEADLINE_INCLUDE },
            { signal, definitions },
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
        // Computed from other definitions than the approved ones
        const refused = mismatch(first);
        if (refused) {
          refuse(refused);
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
      try {
        if (!(await current()) || signal.aborted) return;
        const raw = await postHouseholdImpact(
          { ...body, include: DETAIL_INCLUDE },
          { signal, timeoutMs: DETAIL_TIMEOUT_MS, definitions },
        );
        if (signal.aborted) return;
        const detail = normaliseHouseholdImpact(raw);
        // Checked as the headline was: a deployment between the two stages
        // may compute a measure from another definition
        const refused = mismatch(detail);
        if (refused) throw refused;
        // Refused unless from the headline's own package versions
        const merged = mergeStages(first, detail);
        cache.set(key, { data: merged, complete: true });
        setState({
          key,
          dataKey: key,
          status: "ready",
          data: merged,
          error: null,
          detailStatus: "ready",
          detailError: null,
        });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof EngineMismatchError || error instanceof DefinitionMismatchError) {
          refuse(error);
          return;
        }
        setState((prev) => ({ ...prev, detailStatus: "error", detailError: error }));
      }
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

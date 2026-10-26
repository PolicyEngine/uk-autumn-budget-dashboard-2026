import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DETAIL_PARTS,
  DETAIL_TIMEOUT_MS,
  DefinitionMismatchError,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  definitionRefusals,
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
 * A cache entry's result when it was answered by `expectedEngine` (or no
 * engine is expected), else null. Every reader checks this, whoever wrote
 * the entry: a fetched answer was checked when it arrived, but a seeded one
 * was checked against whatever engine its writer had (#104).
 */
function underEngine(entry, expectedEngine) {
  if (!entry) return null;
  if (expectedEngine && engineDifferences(expectedEngine, entry.data?.engine).length) return null;
  return entry;
}

/**
 * A result already in the session cache for a request key (fetched, or a
 * precomputed example), or null; null too when `expectedEngine` is given and
 * the result's package versions differ, or when the result does not report
 * the approved definition (`approved`) of every one of `policies`, the
 * measures the key was asked with: the check this hook makes of its own
 * cache (#136). With no policies there is nothing to check it against, and
 * no result. Its headline may be all it has.
 */
export function peekHouseholdImpact(key, expectedEngine, approved, policies) {
  const data = underEngine(cache.get(key), expectedEngine)?.data ?? null;
  if (!data || !Array.isArray(policies) || policies.length === 0) return null;
  return definitionRefusals(approved ?? {}, data.definitions ?? null, policies).length === 0 ? data : null;
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
 * @param {Object<string, Object>} [params.expectedDefinitions] - Each
 *   selected measure's approved definition (`publishedDefinitions`). Both
 *   stages name their commits, and a main API answer whose reported
 *   definitions differ, or that reports none, is refused: a
 *   DefinitionMismatchError naming the measures (a detail service answer
 *   like that is asked again of the main API). A measure asked about with
 *   none here is refused before any request, so leaving it out never shows
 *   an unchecked answer.
 *   Only those of `policies` are used and sent, and the request is checked
 *   again when one of them comes or goes. An answer in the session cache is
 *   shown only when it reports them too: a precomputed example's has the
 *   ones its file recorded (utils/householdPresets.js), and one with none
 *   or others is asked of the API instead
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
export default function useHouseholdImpact({ inputs, year, policies, enabled, publicationKey = "", expectedEngine = null, expectedDefinitions = null, confirmPublication = null, seeded = 0, household = null }) {
  const body = useMemo(
    () => buildHouseholdRequest(inputs, { year, policies }),
    [inputs, year, policies],
  );
  const key = `${publicationKey}:${requestKey(body)}`;
  // The approved definitions of the measures asked about, and only those:
  // each request names them. The page works them out from the current
  // selection, which can differ from the policies asked about (answers sent
  // with Calculate, then edited while the bar changed). The check is made
  // again whenever one of them comes or goes, so a refusal never outlives
  // the definitions it was made against.
  const approved = Object.fromEntries(
    policies.filter((id) => Object.hasOwn(expectedDefinitions ?? {}, id)).map((id) => [id, expectedDefinitions[id]]),
  );
  const checksKey = JSON.stringify([Object.entries(approved), expectedEngine]);
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
    const controller = new AbortController();
    const { signal } = controller;
    const refuse = (error) => {
      cache.delete(key);
      setState({ key, dataKey: null, dataHousehold: null, status: "error", data: null, error, detailStatus: "idle", detailError: null });
      // Nothing else this request asked for can be shown now
      controller.abort();
    };
    // Nothing is answered unchecked: a selected measure with no approved
    // definition is refused before any request
    const unapproved = policies.filter((id) => !Object.hasOwn(approved, id));
    if (unapproved.length) {
      refuse(new DefinitionMismatchError(definitionRefusals(approved, null, unapproved)));
      return undefined;
    }
    // An entry from other package versions, or one that doesn't report
    // every selected measure's approved definition, is a miss: the live
    // answer replaces it. A fetched answer was checked when it arrived; a
    // precomputed example's has the definitions its file recorded, or none.
    const entry = underEngine(cache.get(key), expectedEngine);
    const cached =
      entry && definitionRefusals(approved, entry.data?.definitions ?? null, policies).length === 0 ? entry : null;
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
    // The refusal of the selected measures the API's code does not compute
    // from their approved definitions, or null when it computes them all
    const mismatch = (answer) => {
      const refused = definitionRefusals(approved, answer.definitions, policies);
      return refused.length ? new DefinitionMismatchError(refused, { unchecked: answer.definitions === null }) : null;
    };
    const definitions = approved;
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
      // live publication. A part the detail service answers from another
      // build than the headline's, or with a measure computed from another
      // definition than its approved one, is asked again of the main API; a
      // part the main API answers so refuses the whole result.
      if (!(await current()) || signal.aborted) return;
      let merged = first;
      let failure = null;
      let refused = false;
      const parts = DETAIL_PARTS.filter((include) =>
        include.some((part) => (part === "sweep" ? merged.sweep : merged.byPolicy) === null),
      );
      // The detail service's answer is used only if it has the part asked
      // for, reports the headline's build commit, matches it, and computes
      // every measure from its approved definition (a stale or pre-#125
      // deploy doesn't); otherwise the part is asked of the main API
      const acceptFor = (include) => (raw) => {
        try {
          const detail = normaliseHouseholdImpact(raw);
          const answered = include.every((part) => (part === "sweep" ? detail.sweep : detail.byPolicy) !== null);
          return answered && stageMismatch(first, detail, { sameBuild: true }) === null && mismatch(detail) === null;
        } catch {
          return false;
        }
      };
      await Promise.all(
        parts.map(async (include) => {
          try {
            const raw = await postHouseholdDetail(
              { ...body, include },
              { signal, timeoutMs: DETAIL_TIMEOUT_MS, definitions, accept: acceptFor(include) },
            );
            if (signal.aborted || refused) return;
            const detail = normaliseHouseholdImpact(raw);
            // Checked as the headline was: the main API's answer comes back
            // as it is, and a deployment between the two stages may compute a
            // measure from another definition
            const mismatched = mismatch(detail);
            if (mismatched) throw mismatched;
            // Refused unless from the headline's own package versions and,
            // where both report one, its build commit
            merged = mergeStages(merged, detail);
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
            if (error instanceof EngineMismatchError || error instanceof DefinitionMismatchError) {
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
    // body is derived from key's inputs, approved and expectedEngine from
    // checksKey's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, household, enabled, attempt, policies.length, checksKey, seeded]);

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

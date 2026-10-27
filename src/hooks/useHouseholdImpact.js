import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DETAIL_PARTS,
  DETAIL_TIMEOUT_MS,
  DefinitionMismatchError,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  MODAL_TIMEOUT_MS,
  buildHouseholdRequest,
  definitionRefusals,
  engineDifferences,
  mergeStages,
  normaliseHouseholdImpact,
  householdDetailApiUrl,
  postHouseholdDetail,
  postHouseholdImpact,
  postHouseholdImpactRetrying,
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

// Whether the detail service (NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL) may
// still be asked this session. Its answer is used only under a headline
// that reports a build commit, and only from that commit; once it has
// answered from another build (another commit, none, other package versions
// or another net income), every later answer would be refused too, so the
// page stops waiting for it and asks the main API at once.
let detailServiceUsable = true;

// The build commit the last headline fetched this session reported:
// undefined before the first, null when it reported none. The detail
// service's parts are asked for early (with the headline) only while it is
// not null: under a headline that reports no commit, no detail answer can
// be used, so asking early would only spend its runs.
let lastHeadlineBuild;

// Overrides of RETRY_POLICY (householdImpactApi.js) for the requests this
// hook retries while the service is starting up: none outside tests
let retryPolicy = {};

/** Whether the detail service may still be asked this session (for tests). */
export function detailServiceAsked() {
  return detailServiceUsable;
}

/**
 * Shorten the waits between retries (for tests: a real retry waits 5 s or
 * the service's Retry-After). Reset by clearHouseholdImpactCache.
 */
export function setHouseholdRetryPolicy(overrides) {
  retryPolicy = { ...overrides };
}

/** Empty the session cache, and ask the detail service again (for tests). */
export function clearHouseholdImpactCache() {
  cache.clear();
  detailServiceUsable = true;
  lastHeadlineBuild = undefined;
  retryPolicy = {};
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

/**
 * Add one headline (no sweep or split by policy) to the session cache, as
 * the example cards' background fill gets it (useExampleFigures.js): a
 * request for it then shows the headline at once and asks only for the
 * details. An entry already there is kept.
 */
export function rememberHouseholdHeadline(key, data) {
  if (!cache.has(key)) cache.set(key, { data, complete: false });
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
 *   detailError: Error|null, startingUp: boolean, detailStartingUp: boolean,
 *   retry: () => void }} `startingUp` while the headline is asked again
 *   because the service looked to be starting up (an empty answer, a 5xx,
 *   a timeout); `detailStartingUp` the same for the sweep and the split
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
    startingUp: false,
    detailStartingUp: false,
  });

  useEffect(() => {
    if (!enabled || policies.length === 0) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    const refuse = (error) => {
      cache.delete(key);
      setState({ key, dataKey: null, dataHousehold: null, status: "error", data: null, error, detailStatus: "idle", detailError: null, startingUp: false, detailStartingUp: false });
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
        startingUp: false,
        detailStartingUp: false,
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
      startingUp: false,
      detailStartingUp: false,
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
      // Whether this request fetched its headline: one kept in the cache
      // (an example card's, or this household's from earlier in the session)
      // may come from a deploy that has since been replaced
      const headlineFetched = !first;
      // With a detail service (Modal), its parts are asked for at the same
      // time as Cloud Run's headline rather than after it: each run has its
      // own container there, so they take no worker slot from the headline,
      // and the breakdown arrives about when the headline does instead of a
      // detail's time later (#253: 34 s to 15-20 s on a warm Modal). An
      // early answer is still used only under the headline once it arrives,
      // from its build (acceptFor below); otherwise the part is asked of
      // Cloud Run, as before. Not under a cached headline: the parts are
      // asked at once then anyway.
      const detailUrl = householdDetailApiUrl();
      const early = new Map();
      const earlyController = new AbortController();
      signal.addEventListener("abort", () => earlyController.abort());
      if (!first) {
        try {
          if (!(await current()) || signal.aborted) return;
          if (detailUrl && detailServiceUsable && lastHeadlineBuild !== null) {
            for (const include of DETAIL_PARTS) {
              early.set(
                include,
                // Not past MODAL_TIMEOUT_MS: a cold Modal that has sent
                // nothing by then would answer with an empty body at 150 s
                postHouseholdImpact(
                  { ...body, include },
                  { signal: earlyController.signal, timeoutMs: MODAL_TIMEOUT_MS, definitions, url: detailUrl },
                ).then(
                  (raw) => ({ raw }),
                  (error) => ({ error }),
                ),
              );
            }
          }
          // Asked again while the service looks to be starting up (an
          // empty answer, a 5xx, a timeout), within RETRY_POLICY's budget;
          // the page says so meanwhile (`startingUp`). The retried answer is
          // checked below exactly as a first answer is.
          const raw = await postHouseholdImpactRetrying(
            { ...body, include: HEADLINE_INCLUDE },
            {
              signal,
              definitions,
              retry: retryPolicy,
              onRetry: () => {
                if (!signal.aborted) setState((prev) => ({ ...prev, key, startingUp: true }));
              },
            },
          );
          first = normaliseHouseholdImpact(raw);
          lastHeadlineBuild = typeof first.build === "string" ? first.build : null;
        } catch (error) {
          // No headline: nothing asked early can be shown
          earlyController.abort();
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
            startingUp: false,
            detailStartingUp: false,
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
          startingUp: false,
          detailStartingUp: false,
        });
        if (complete) {
          earlyController.abort();
          return;
        }
      }
      // The sweep and the split by policy, asked for at once: each part is
      // shown as soon as its own answer arrives. They wait for a check of the
      // live publication. A part the detail service answers from another
      // build than the headline's, or with a measure computed from another
      // definition than its approved one, is asked again of the main API; a
      // part the main API answers so refuses the whole result.
      if (!(await current()) || signal.aborted) {
        earlyController.abort();
        return;
      }
      let merged = first;
      let failure = null;
      let refused = false;
      const parts = DETAIL_PARTS.filter((include) =>
        include.some((part) => (part === "sweep" ? merged.sweep : merged.byPolicy) === null),
      );
      // The detail service's answer is used only if it has the part asked
      // for, reports the headline's build commit, matches it, and computes
      // every measure from its approved definition (a stale or pre-#125
      // deploy doesn't); otherwise the part is asked of the main API. An
      // answer from another build than a headline fetched just now stops the
      // page asking the detail service for the rest of the session
      const acceptFor = (include) => (raw) => {
        try {
          const detail = normaliseHouseholdImpact(raw);
          const answered = include.every((part) => (part === "sweep" ? detail.sweep : detail.byPolicy) !== null);
          const otherBuild = stageMismatch(first, detail, { sameBuild: true }) !== null;
          // Only a headline fetched just now stands for the main API's
          // current build: under one kept from an earlier deploy, a detail
          // answer from the new one is refused for this request but says
          // nothing about the next
          if (otherBuild && headlineFetched) detailServiceUsable = false;
          return answered && !otherBuild && mismatch(detail) === null;
        } catch {
          return false;
        }
      };
      // Under a headline that reports no build commit (a deploy from before
      // answers carried one), no detail answer can be accepted: asking the
      // detail service would only add its time, up to a cold start, before
      // the main API is asked anyway
      const askDetail = detailServiceUsable && typeof first.build === "string";
      await Promise.all(
        parts.map(async (include) => {
          try {
            const accept = acceptFor(include);
            // An early answer from the detail service, kept if it passes
            // the same check a later one would; otherwise Cloud Run's
            const asked = askDetail ? await early.get(include) : undefined;
            if (!askDetail) earlyController.abort();
            const raw =
              asked && !asked.error && accept(asked.raw)
                ? asked.raw
                : await postHouseholdDetail(
                    { ...body, include },
                    {
                      signal,
                      timeoutMs: DETAIL_TIMEOUT_MS,
                      definitions,
                      accept,
                      // Asked early already: an answer that failed or was
                      // refused there goes to Cloud Run at once
                      detail: askDetail && !early.has(include),
                      // Cloud Run asked again while it looks to be starting
                      // up; the answer is checked by mergeStages as ever
                      retry: retryPolicy,
                      onRetry: () => {
                        if (!signal.aborted) setState((prev) => ({ ...prev, detailStartingUp: true }));
                      },
                    },
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
              detailStartingUp: complete ? false : prev.detailStartingUp,
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
        detailStartingUp: false,
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
    startingUp: asked ? state.startingUp : false,
    detailStartingUp: asked ? state.detailStartingUp : false,
    stale,
    retry,
  };
}

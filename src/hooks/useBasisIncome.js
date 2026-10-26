import { useEffect, useState } from "react";
import {
  EngineMismatchError,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  engineDifferences,
  normaliseHouseholdImpact,
  postHouseholdImpact,
  requestKey,
} from "../utils/householdImpactApi";
import { peekHouseholdImpact } from "./useHouseholdImpact";

// This hook's own answers, by key. Kept apart from useHouseholdImpact's
// cache: an answer there is shown as the page's headline, and this one has
// not had that hook's check of the live publication (#104).
const fetchedIncomes = new Map();

/** Empty this hook's own answers (for tests). */
export function clearBasisIncomeCache() {
  fetchedIncomes.clear();
}

/**
 * A household's baseline net income in the scatter's basis year (2027-28):
 * the y axis of "Household income impacts", which bands every year's
 * households by that year's baseline income. The baseline does not depend
 * on the policies selected, so any answer for these answers in that year
 * will do: the result already shown (when its year is the basis year), an
 * answer in the session cache (the examples' precomputed answers are there
 * for the published measures), or else one headline request (two runs, no
 * sweep or split by policy).
 *
 * #104: the session cache is read under useHouseholdImpact's own keys (the
 * publication snapshot, then the request), so only answers that passed its
 * checks are used. This hook's own request is refused when its package
 * versions differ from the receipts' (`expectedEngine`), as the page's are.
 *
 * @param {Object} params
 * @param {Object|null} params.inputs - The answers the result was asked with
 * @param {string[]} params.policies - The policies it was asked with
 * @param {string[]} [params.presetPolicies] - The measures the examples'
 *   precomputed answers cover (every published one)
 * @param {string} [params.publicationKey] - The publication snapshot the
 *   page's answers are keyed by
 * @param {Object<string, string>|null} [params.expectedEngine] - The
 *   receipts' package versions
 * @param {number|null} params.basisYear - The scatter's basis year
 * @param {boolean} params.enabled - Look only while a result is shown
 * @returns {{ status: "idle"|"loading"|"ready"|"error", income: number|null }}
 */
export default function useBasisIncome({
  inputs,
  policies,
  presetPolicies = [],
  publicationKey = "",
  expectedEngine = null,
  basisYear,
  enabled,
}) {
  const policySets = [policies, presetPolicies];
  const keys =
    enabled && inputs && basisYear
      ? policySets
          .filter((set) => set.length > 0)
          .map((set) => `${publicationKey}:${requestKey(buildHouseholdRequest(inputs, { year: basisYear, policies: set }))}`)
      : [];
  const primary = keys[0] ?? null;
  const fromCache = () => {
    for (const key of keys) {
      const data = peekHouseholdImpact(key);
      if (data && Number.isFinite(data.net?.before)) return data.net.before;
    }
    return primary !== null && fetchedIncomes.has(primary) ? fetchedIncomes.get(primary) : null;
  };
  const cached = fromCache();
  const [fetched, setFetched] = useState({ key: null, status: "idle", income: null });

  useEffect(() => {
    if (!primary || cached !== null) return undefined;
    const controller = new AbortController();
    setFetched({ key: primary, status: "loading", income: null });
    postHouseholdImpact(
      { ...buildHouseholdRequest(inputs, { year: basisYear, policies }), include: HEADLINE_INCLUDE },
      { signal: controller.signal },
    )
      .then((raw) => {
        if (controller.signal.aborted) return;
        const data = normaliseHouseholdImpact(raw);
        const differ = expectedEngine ? engineDifferences(expectedEngine, data.engine) : [];
        if (differ.length > 0) throw new EngineMismatchError(differ);
        if (!Number.isFinite(data.net?.before)) throw new Error("The answer has no baseline net income");
        fetchedIncomes.set(primary, data.net.before);
        setFetched({ key: primary, status: "ready", income: data.net.before });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ key: primary, status: "error", income: null });
      });
    return () => controller.abort();
    // inputs, policies, basisYear and the publication are in `primary`;
    // expectedEngine is the publication's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, cached === null]);

  if (!primary) return { status: "idle", income: null };
  if (cached !== null) return { status: "ready", income: cached };
  if (fetched.key !== primary) return { status: "loading", income: null };
  return { status: fetched.status, income: fetched.income };
}

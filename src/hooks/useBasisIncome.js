import { useEffect, useState } from "react";
import {
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  normaliseHouseholdImpact,
  postHouseholdImpact,
  requestKey,
} from "../utils/householdImpactApi";
import { peekHouseholdImpact, rememberHouseholdHeadline } from "./useHouseholdImpact";

/**
 * A household's baseline net income in the scatter's basis year (2027-28):
 * the y axis of "Household income impacts", which bands every year's
 * households by that year's baseline income. The baseline does not depend
 * on the policies selected, so any answer for these answers in that year
 * will do: the result already shown (when its year is the basis year), an
 * answer in the session cache (the examples' precomputed answers are there
 * for every measure), or else one headline request (two runs, no sweep or
 * split by policy).
 *
 * @param {Object} params
 * @param {Object|null} params.inputs - The answers the result was asked with
 * @param {string[]} params.policies - The policies it was asked with
 * @param {number|null} params.basisYear - The scatter's basis year
 * @param {boolean} params.enabled - Look only while a result is shown
 * @returns {{ status: "idle"|"loading"|"ready"|"error", income: number|null }}
 */
export default function useBasisIncome({ inputs, policies, basisYear, enabled }) {
  // #185 on #104: the page keeps no list of measures, so only the selection
  // itself is looked up (the examples' file covers its own measures)
  const policySets = [policies];
  const keys =
    enabled && inputs && basisYear
      ? policySets
          .filter((set) => Array.isArray(set) && set.length > 0)
          .map((set) => requestKey(buildHouseholdRequest(inputs, { year: basisYear, policies: set })))
      : [];
  const primary = keys[0] ?? null;
  const fromCache = () => {
    for (const key of keys) {
      const data = peekHouseholdImpact(key);
      if (data && Number.isFinite(data.net?.before)) return data.net.before;
    }
    return null;
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
        rememberHouseholdHeadline(primary, data);
        setFetched({ key: primary, status: "ready", income: data.net.before });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ key: primary, status: "error", income: null });
      });
    return () => controller.abort();
    // inputs, policies and basisYear are in `primary`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, cached === null]);

  if (!primary) return { status: "idle", income: null };
  if (cached !== null) return { status: "ready", income: cached };
  if (fetched.key !== primary) return { status: "loading", income: null };
  return { status: fetched.status, income: fetched.income };
}

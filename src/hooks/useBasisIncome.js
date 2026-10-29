import { useEffect, useState } from "react";
import {
  DefinitionMismatchError,
  EngineMismatchError,
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  definitionRefusals,
  engineDifferences,
  normaliseHouseholdImpact,
  postHouseholdImpact,
  requestKey,
} from "../utils/householdImpactApi";
import { peekHouseholdImpact } from "./useHouseholdImpact";
import { definitionChecked } from "../utils/calculatorOnlyMeasures";

// This hook's own answers, by key. Kept apart from useHouseholdImpact's
// cache: an answer there is shown as the page's headline, and this one has
// not had that hook's check of the live publication (#104).
const fetchedIncomes = new Map();

/** Empty this hook's own answers (for tests). */
export function clearBasisIncomeCache() {
  fetchedIncomes.clear();
}

/** `ids`' approved definitions, or null when one of them has none. */
function approvedFor(ids, definitions) {
  if (ids.length === 0 || !definitions || ids.some((id) => !Object.hasOwn(definitions, id))) return null;
  return Object.fromEntries(ids.map((id) => [id, definitions[id]]));
}

/**
 * A household's baseline net income in the scatter's basis year (2027-28):
 * the y axis of "Household income impacts", which bands every year's
 * households by that year's baseline income. It is read from the result
 * already shown (when its year is the basis year), from an answer in the
 * session cache (the examples' precomputed answers are there, asked with
 * every published measure, and are used for any selection), or else from
 * one headline request (two runs, no sweep or split by policy).
 *
 * #104: the session cache is read under useHouseholdImpact's own keys (the
 * publication snapshot, then the request), and an answer there counts only
 * when its package versions are the receipts' (`expectedEngine`). This
 * hook's own request is refused when they differ, as the page's are.
 *
 * #136: the baseline is not the same for every selection. The API builds it
 * from the selected measures' baseline side (`household_impact.measure_sides`),
 * which a measure's baseline modifier changes (Plan 2's
 * `connect_student_loan_repayments`), so it depends on their definitions
 * too. Every answer is checked as the page's are: it counts only when it
 * reports the approved definition of each measure it was asked with
 * (`expectedDefinitions` for the selection's, `presetDefinitions` for the
 * examples'). This hook's own request names them (`?definition=`) and is
 * refused, as an error, when the answer reports others or none; the ring
 * then goes by the shown result's own baseline income. A selected measure
 * with no approved definition is asked about nowhere: nothing is placed.
 * A calculator-only measure with none, which every household request
 * carries, is asked unchecked, as the calculator asks it
 * (`definitionChecked`).
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
 * @param {Object<string, Object>|null} [params.expectedDefinitions] - The
 *   approved definitions of `policies` (others are ignored)
 * @param {Object<string, Object>|null} [params.presetDefinitions] - The
 *   approved definitions of `presetPolicies`, or null when one has none
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
  expectedDefinitions = null,
  presetDefinitions = null,
  basisYear,
  enabled,
}) {
  // The measures each answer is checked for
  const ownChecked = definitionChecked(policies, expectedDefinitions);
  const presetChecked = definitionChecked(presetPolicies, presetDefinitions);
  const own = approvedFor(ownChecked, expectedDefinitions);
  const preset = approvedFor(presetChecked, presetDefinitions);
  // The selection's own answer first, then the examples'
  const lookups =
    enabled && inputs && basisYear && own
      ? [
          { policies, checked: ownChecked, approved: own },
          ...(preset ? [{ policies: presetPolicies, checked: presetChecked, approved: preset }] : []),
        ].map((set) => ({
          ...set,
          key: `${publicationKey}:${requestKey(buildHouseholdRequest(inputs, { year: basisYear, policies: set.policies }))}`,
        }))
      : [];
  const primary = lookups[0] ?? null;
  // This hook's own answer is kept by the definitions it was checked
  // against as well as the request
  const ownKey = primary ? `${primary.key}#${JSON.stringify(Object.entries(primary.approved))}` : null;
  const fromCache = () => {
    for (const lookup of lookups) {
      const data = peekHouseholdImpact(lookup.key, expectedEngine, lookup.approved, lookup.checked);
      if (data && Number.isFinite(data.net?.before)) return data.net.before;
    }
    return ownKey !== null && fetchedIncomes.has(ownKey) ? fetchedIncomes.get(ownKey) : null;
  };
  const cached = fromCache();
  const [fetched, setFetched] = useState({ key: null, status: "idle", income: null });

  useEffect(() => {
    if (!primary || cached !== null) return undefined;
    const controller = new AbortController();
    setFetched({ key: ownKey, status: "loading", income: null });
    postHouseholdImpact(
      { ...buildHouseholdRequest(inputs, { year: basisYear, policies }), include: HEADLINE_INCLUDE },
      { signal: controller.signal, definitions: primary.approved },
    )
      .then((raw) => {
        if (controller.signal.aborted) return;
        const data = normaliseHouseholdImpact(raw);
        const differ = expectedEngine ? engineDifferences(expectedEngine, data.engine) : [];
        if (differ.length > 0) throw new EngineMismatchError(differ);
        const refused = definitionRefusals(primary.approved, data.definitions ?? null, primary.checked);
        if (refused.length > 0) throw new DefinitionMismatchError(refused, { unchecked: data.definitions === null });
        if (!Number.isFinite(data.net?.before)) throw new Error("The answer has no baseline net income");
        fetchedIncomes.set(ownKey, data.net.before);
        setFetched({ key: ownKey, status: "ready", income: data.net.before });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ key: ownKey, status: "error", income: null });
      });
    return () => controller.abort();
    // inputs, policies, basisYear, the publication and the approved
    // definitions are in `ownKey`; expectedEngine is the publication's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownKey, cached === null]);

  if (!primary) return { status: "idle", income: null };
  if (cached !== null) return { status: "ready", income: cached };
  if (fetched.key !== ownKey) return { status: "loading", income: null };
  return { status: fetched.status, income: fetched.income };
}

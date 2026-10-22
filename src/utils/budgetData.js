import { DISPLAY_YEARS, isPublishedYear } from "./displayYears";

/**
 * The revenue chart's points, one per year the dashboard shows.
 *
 * Each published year carries one value per policy (zero when the policy
 * is not selected, so the bars animate) and their net sum. A year the
 * published files do not cover yet is marked unpublished, never zero.
 *
 * @param {Array<Object>} rows - budgetary_impact.csv rows (reform_id,
 *   year, value), for every policy.
 * @param {Array<{id: string, name: string}>} policies - The policies, in
 *   chart order.
 * @param {Array<string>} selectedPolicies - The ids to add up.
 * @param {Array<number>} [years] - The years to chart.
 */
export function buildBudgetData(
  rows,
  policies,
  selectedPolicies,
  years = DISPLAY_YEARS,
) {
  return years.map((year) => {
    if (!isPublishedYear(rows, year)) {
      return { year, netImpact: null, unpublished: true };
    }
    const point = { year };
    let netImpact = 0;
    policies.forEach((policy) => {
      const row = rows.find(
        (candidate) =>
          candidate.reform_id === policy.id && Number(candidate.year) === year,
      );
      const value =
        selectedPolicies.includes(policy.id) && row ? parseFloat(row.value) : 0;
      point[policy.name] = value;
      netImpact += value;
    });
    point.netImpact = netImpact;
    return point;
  });
}

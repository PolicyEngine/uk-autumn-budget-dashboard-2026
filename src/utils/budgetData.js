/**
 * The revenue chart's points, one per year the dashboard shows.
 */
import { DISPLAY_YEARS } from "./displayYears";

/**
 * Build the revenue chart's points from budgetary_impact.csv rows.
 *
 * Every shown year gets a point. A year with rows in the file carries each
 * policy's value (0 when the policy is not selected) and their sum as
 * netImpact, with every policy key present so the bars animate smoothly. A
 * year the config lists but the file does not cover is marked unpublished,
 * never drawn as zero.
 *
 * @param {Array<{reform_id: string, year: string|number, value: string|number}>} rows
 * @param {Array<{id: string, name: string}>} policies
 * @param {string[]} selectedPolicies - Selected policy ids
 * @param {readonly number[]} [years]
 */
export function buildBudgetData(rows, policies, selectedPolicies, years = DISPLAY_YEARS) {
  return years.map((year) => {
    const yearRows = rows.filter((row) => Number(row.year) === year);
    if (yearRows.length === 0) {
      // In the config, not yet in the published files
      return { year, netImpact: null, unpublished: true };
    }
    const point = { year };
    let netImpact = 0;
    policies.forEach((policy) => {
      const row = yearRows.find((r) => r.reform_id === policy.id);
      const value =
        selectedPolicies.includes(policy.id) && row ? parseFloat(row.value) : 0;
      point[policy.name] = value;
      netImpact += value;
    });
    point.netImpact = netImpact;
    return point;
  });
}

// The later years a card's "Later years differ" pointer reads
// (plainSentences.js): the decile pair's lowest- and highest-income tenths
// in each displayed year after the selected one, summed over the selected
// measures as the decile cards sum them. A year where a selected measure
// has no published row is left out, never read as zero.

import { DISPLAY_YEARS } from "./displayYears";
import { fiscalYearTick } from "./chartTheme";
import { isCatalogueRowDisplayable } from "./measureCatalogue";

/**
 * @param {Object[]} rawData - distributional_impact.csv or winners_losers.csv rows
 * @param {Object} options
 * @param {string} options.valueKey - "value" (share of income) or "avg_change" (£)
 * @param {[string, string]} options.ends - The two deciles' labels, lowest first ("1st", "10th" or "1", "10")
 * @param {string[]} options.selectedPolicies
 * @param {Object} options.catalogue - The measure catalogue (displayable measures)
 * @param {number} options.selectedYear
 * @param {number[]} [options.years] - The years shown (DISPLAY_YEARS)
 * @returns {Array<{year: number, yearLabel: string, low: number, high: number}>}
 */
export function laterDecileEnds(rawData, { valueKey, ends, selectedPolicies, catalogue, selectedYear, years = DISPLAY_YEARS }) {
  if (!rawData?.length || !selectedPolicies?.length) return [];
  const policies = catalogue.displayable ?? [];
  const selected = policies.filter((policy) => selectedPolicies.includes(policy.id));
  // A selected measure that is not displayable leaves every year incomplete
  if (selected.length !== selectedPolicies.length) return [];
  const out = [];
  for (const year of years) {
    if (year <= selectedYear) continue;
    const rows = rawData.filter(
      (row) =>
        Number.parseInt(row.year, 10) === year &&
        selectedPolicies.includes(row.reform_id) &&
        isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
    );
    const sumFor = (decile) => {
      let total = 0;
      for (const policy of selected) {
        const row = rows.find((candidate) => candidate.reform_id === policy.id && String(candidate.decile) === decile);
        const value = row ? Number.parseFloat(row[valueKey]) : NaN;
        if (!Number.isFinite(value)) return null;
        total += value;
      }
      return total;
    };
    const low = sumFor(ends[0]);
    const high = sumFor(ends[1]);
    if (low === null || high === null) continue;
    out.push({ year, yearLabel: fiscalYearTick(year), low, high });
  }
  return out;
}

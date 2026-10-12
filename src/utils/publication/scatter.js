/**
 * The household scatter, as published: binned cells, never households.
 *
 * Each artifact's `household_scatter_binned` table gives the weighted number
 * of households in each cell of baseline income band by income change band
 * (`contract.scatter_bins`). The outer bands are open-ended, and cells with
 * too few survey households are left out, so the cells need not cover every
 * household.
 */

import contract from "./contract.json";
import { combinedEntryFor, isSupported, REASONS, uniqueIds } from "./select";

export const SCATTER_BINS = contract.scatter_bins;

/** A band's label, with the outer bands shown as open-ended. */
export function bandLabel(lower, width, min, max, format) {
  if (lower <= min) return `under ${format(min + width)}`;
  if (lower + width >= max) return `${format(lower)} and over`;
  return `${format(lower)} to ${format(lower + width)}`;
}

/**
 * The selection's binned scatter for one year.
 *
 * Read only from the entry that describes the whole selection (one measure's
 * own artifact, or the exact-set combined run), like the other combined
 * figures.
 *
 * @returns {{status: "available", key: string, provisional: boolean,
 *   points: Array<{income: number, change: number, households: number,
 *   incomeBand: number, changeBand: number}>}
 *   | {status: "unavailable", reason: string}}
 */
export function scatterSeries({ manifest, tablesByKey, selectedIds, year }) {
  const ids = uniqueIds(selectedIds);
  if (ids.length === 0) {
    return { status: "unavailable", reason: REASONS.noSelection };
  }
  const target = combinedEntryFor(manifest, ids);
  if (!target) {
    return {
      status: "unavailable",
      reason: ids.length > 1 ? REASONS.noCombinedRun : REASONS.notPublished,
    };
  }
  if (!isSupported(target.entry, year)) {
    return {
      status: "unavailable",
      reason: target.entry.years.includes(year)
        ? REASONS.unsupportedYear
        : REASONS.yearNotPublished,
    };
  }
  const rows = tablesByKey?.[target.key]?.household_scatter_binned;
  if (!Array.isArray(rows)) {
    return { status: "unavailable", reason: REASONS.notLoaded };
  }
  const bins = SCATTER_BINS;
  const points = rows
    .filter((row) => row.reform_id === target.key && row.year === year)
    .map((row) => ({
      income: row.income_band + bins.income_band_width / 2,
      change: row.change_band + bins.change_band_width / 2,
      households: row.households,
      incomeBand: row.income_band,
      changeBand: row.change_band,
    }));
  if (points.length === 0) {
    return { status: "unavailable", reason: REASONS.missingRow };
  }
  return {
    status: "available",
    key: target.key,
    provisional: target.entry.status === "provisional",
    points,
  };
}

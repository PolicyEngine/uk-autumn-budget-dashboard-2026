/**
 * The household scatter, as published: binned cells, never households.
 *
 * Each artifact's `household_scatter_binned` table gives the weighted number
 * of households in each cell of baseline income band by income change band
 * (`contract.scatter_bins`). Change bands run between `change_edges`, narrow
 * near zero, each named by its lower edge and `change_band_upper`. The outer
 * bands are open-ended, and cells with
 * too few survey households are left out, so the cells need not cover every
 * household.
 */

import contract from "./contract.json";
import { measureAvailability } from "./manifest";
import {
  combinedEntryFor,
  isProvisionalTarget,
  isSupported,
  REASONS,
  uniqueIds,
} from "./select";

export const SCATTER_BINS = contract.scatter_bins;

/** The change band edges, from the largest loss to the largest gain. */
export const CHANGE_EDGES = SCATTER_BINS.change_edges;
/** The edge beyond which the outer change bands are open (-£5,000). */
export const CHANGE_MIN = CHANGE_EDGES[0];
/** The edge beyond which the outer change bands are open (£5,000). */
export const CHANGE_MAX = CHANGE_EDGES[CHANGE_EDGES.length - 1];

/**
 * What kind of change band (lower, upper) is. The bands mirror about zero:
 * the zero band is (-1, 1); gains fall in [lower, upper) and losses in
 * (lower, upper]; the open outer bands are named by their edge on both
 * sides, (5000, 5000) and (-5000, -5000).
 *
 * @returns {"zero"|"gain"|"loss"}
 */
export function changeKind(lower, upper) {
  if (lower < 0 && upper > 0) return "zero";
  return lower >= 0 ? "gain" : "loss";
}

/** Whether a change band is an open outer band ("upper", "lower" or null). */
export function openEdge(lower, upper) {
  if (lower !== upper) return null;
  return lower > 0 ? "upper" : "lower";
}

/** A change band as words: "No change", "£100 to £150", "£5,000 or more". */
export function changeBandLabel(lower, upper, format) {
  const edge = openEdge(lower, upper);
  if (edge === "upper") return `${format(lower)} or more`;
  if (edge === "lower") return `${format(lower)} or less`;
  if (changeKind(lower, upper) === "zero") return "No change";
  return `${format(lower)} to ${format(upper)}`;
}

/**
 * The symlog constant of the change axis: changes much smaller than it are
 * spaced evenly, much larger ones logarithmically.
 */
export const SYMLOG_CONSTANT = 10;

/** A change in £ on the symlog change axis. */
export function toChangeAxis(value, constant = SYMLOG_CONSTANT) {
  return Math.sign(value) * Math.log10(1 + Math.abs(value) / constant);
}

/** A place on the symlog change axis back in £. */
export function fromChangeAxis(position, constant = SYMLOG_CONSTANT) {
  return Math.sign(position) * constant * (10 ** Math.abs(position) - 1);
}

/** The middle of a change band on the symlog axis, in £ (open bands: their edge). */
export function changeBandMiddle(lower, upper) {
  if (changeKind(lower, upper) === "zero") return 0;
  if (lower === upper) return lower;
  return fromChangeAxis((toChangeAxis(lower) + toChangeAxis(upper)) / 2);
}

/** An income band's label, with the outer bands shown as open-ended. */
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
 *   incomeBand: number, changeBand: number, changeBandUpper: number}>}
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
      reason:
        ids.length > 1
          ? REASONS.noCombinedRun
          : measureAvailability(manifest, ids[0]).reason,
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
      change: changeBandMiddle(row.change_band, row.change_band_upper),
      households: row.households,
      incomeBand: row.income_band,
      changeBand: row.change_band,
      changeBandUpper: row.change_band_upper,
    }));
  if (points.length === 0) {
    return { status: "unavailable", reason: REASONS.missingRow };
  }
  return {
    status: "available",
    key: target.key,
    provisional: isProvisionalTarget(manifest, target),
    points,
  };
}

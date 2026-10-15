/**
 * What the page may show for a selection of measures.
 *
 * Three rules, each of which the old page broke:
 *
 * 1. A figure that is not published is `null` with a reason, never zero.
 * 2. A combined figure comes only from a combined run of exactly the
 *    selected measures. Standalone figures are never added up to make one,
 *    and one measure's statistics never stand in for the selection's.
 * 3. A year beyond the dataset's projected years is unavailable.
 *
 * Everything here is pure: it takes the parsed manifest and the verified
 * tables, and returns plain data.
 */

import contract from "./contract.json";
import { isDisplayable, measureAvailability } from "./manifest";

export const REASONS = {
  noSelection: "No measures selected",
  notPublished: "Not yet published",
  unsupportedYear: "Beyond the dataset's projected years",
  yearNotPublished: "Not published for this year",
  notLoaded: "The published files could not be loaded or verified",
  missingRow: "No figure published for this year",
  noCombinedRun: "No combined run is published for this selection",
};

/** How each decile table names its groups and its value. */
const DECILE_TABLES = {
  distributional_impact: { groups: contract.deciles, column: "value" },
  winners_losers: { groups: contract.winners_groups, column: "avg_change" },
};

/** The selection as a set: duplicates removed, order ignored. */
export function uniqueIds(ids) {
  return [...new Set(ids ?? [])].sort();
}

function sameSet(left, right) {
  return JSON.stringify(uniqueIds(left)) === JSON.stringify(uniqueIds(right));
}

function measureEntry(manifest, id) {
  return Object.hasOwn(manifest.measures, id)
    ? manifest.measures[id]
    : undefined;
}

/** A combined run is current only while every member is as it was run. */
function membersAreCurrent(manifest, entry) {
  return entry.measures.every((id) => {
    const member = measureEntry(manifest, id);
    return (
      isDisplayable(member) &&
      entry.member_outputs_sha256?.[id] === member.outputs_sha256
    );
  });
}

/**
 * The entry whose figures describe the whole selection.
 *
 * For one measure that is the measure's own entry (`single: true`). For
 * several it is the displayable combined run of exactly that set, if one is
 * published. Otherwise null.
 *
 * @returns {{key: string, entry: Object, single: boolean}|null}
 */
export function combinedEntryFor(manifest, selectedIds) {
  const ids = uniqueIds(selectedIds);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const entry = measureEntry(manifest, ids[0]);
    return isDisplayable(entry) ? { key: ids[0], entry, single: true } : null;
  }
  for (const key of Object.keys(manifest.combined).sort()) {
    const entry = manifest.combined[key];
    if (
      isDisplayable(entry) &&
      sameSet(entry.measures, ids) &&
      membersAreCurrent(manifest, entry)
    ) {
      return { key, entry, single: false };
    }
  }
  return null;
}

/** The measure sets for which a combined run may be shown. */
export function availableCombinedSets(manifest) {
  return Object.keys(manifest.combined)
    .sort()
    .map((key) => manifest.combined[key])
    .filter(
      (entry) => isDisplayable(entry) && membersAreCurrent(manifest, entry),
    )
    .map((entry) => uniqueIds(entry.measures));
}

/**
 * Whether figures from this target must carry the provisional label: its
 * own entry is provisional, or, for a combined run, any member is.
 */
export function isProvisionalTarget(manifest, target) {
  if (!target) return false;
  if (target.entry.status === "provisional") return true;
  return (target.entry.measures ?? []).some(
    (id) => measureEntry(manifest, id)?.status === "provisional",
  );
}

/** True when the entry publishes this year and the dataset supports it. */
export function isSupported(entry, year) {
  return (
    entry.years.includes(year) &&
    !(entry.unsupported_years ?? []).includes(year)
  );
}

/** One published number, or null with the reason it cannot be shown. */
function readCell({ tablesByKey, key, entry, table, column, year, match }) {
  if (!entry.years.includes(year)) {
    return { value: null, reason: REASONS.yearNotPublished };
  }
  if (!isSupported(entry, year)) {
    return { value: null, reason: REASONS.unsupportedYear };
  }
  const rows = tablesByKey?.[key]?.[table];
  if (!Array.isArray(rows)) return { value: null, reason: REASONS.notLoaded };
  const found = rows.filter(
    (row) => row.reform_id === key && row.year === year && match(row),
  );
  const value = found.length === 1 ? found[0][column] : null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, reason: REASONS.missingRow };
  }
  return { value, reason: "" };
}

function summarise({ manifest, tablesByKey, ids, target, cell }) {
  const standalone = {};
  const reasons = {};
  const provisionalIds = [];
  for (const id of ids) {
    const entry = measureEntry(manifest, id);
    const availability = isDisplayable(entry)
      ? readCell({ tablesByKey, key: id, entry, ...cell })
      : {
          value: null,
          reason: entry
            ? measureAvailability(manifest, id).reason
            : REASONS.notPublished,
        };
    standalone[id] = availability.value;
    reasons[id] = availability.reason;
    if (availability.value !== null && entry.status === "provisional") {
      provisionalIds.push(id);
    }
  }

  let combined = { value: null, reason: REASONS.noSelection };
  if (target) {
    combined = readCell({
      tablesByKey,
      key: target.key,
      entry: target.entry,
      ...cell,
    });
  } else if (ids.length === 1) {
    combined = { value: null, reason: reasons[ids[0]] };
  } else if (ids.length > 1) {
    combined = { value: null, reason: REASONS.noCombinedRun };
  }

  const parts = ids.map((id) => standalone[id]);
  const interaction =
    combined.value !== null &&
    ids.length > 0 &&
    parts.every((part) => part !== null)
      ? combined.value - parts.reduce((sum, part) => sum + part, 0)
      : null;

  return {
    standalone,
    reasons,
    combined: combined.value,
    combinedKey: target ? target.key : null,
    combinedReason: combined.reason,
    provisional:
      (combined.value !== null && isProvisionalTarget(manifest, target)) ||
      provisionalIds.length > 0,
    provisionalIds,
    interaction,
  };
}

/**
 * Fiscal impact by year: each measure alone, the combined run, and the
 * interaction between them (combined minus the sum of the standalone runs).
 *
 * @returns {Array<{year: number, standalone: Object, reasons: Object,
 *   combined: number|null, combinedKey: string|null, combinedReason: string,
 *   provisional: boolean, interaction: number|null}>}
 */
export function fiscalSeries({ manifest, tablesByKey, selectedIds, years }) {
  const ids = uniqueIds(selectedIds);
  const target = combinedEntryFor(manifest, ids);
  return years.map((year) => ({
    year,
    ...summarise({
      manifest,
      tablesByKey,
      ids,
      target,
      cell: {
        table: "budgetary_impact",
        column: "value",
        year,
        match: () => true,
      },
    }),
  }));
}

/**
 * The same, by income decile, for one year.
 *
 * @param {"distributional_impact"|"winners_losers"} table
 */
export function decileSeries({
  manifest,
  tablesByKey,
  selectedIds,
  year,
  table,
}) {
  if (!Object.hasOwn(DECILE_TABLES, table)) {
    throw new Error(`${table} is not a decile table`);
  }
  const { groups, column } = DECILE_TABLES[table];
  const ids = uniqueIds(selectedIds);
  const target = combinedEntryFor(manifest, ids);
  return groups.map((decile) => ({
    decile,
    ...summarise({
      manifest,
      tablesByKey,
      ids,
      target,
      cell: { table, column, year, match: (row) => row.decile === decile },
    }),
  }));
}

const STATISTICS = {
  peopleAffected: "people_affected",
  giniChange: "gini_change",
  povertyChangePp: "poverty_change_pp",
  povertyChangePct: "poverty_change_pct",
};

/**
 * Headline statistics for the whole selection in one year.
 *
 * They are read from the selection's own run: the measure's artifact for one
 * measure, the exact-set combined run for several. With several measures
 * selected, no standalone measure's statistics are ever read.
 *
 * @returns {{status: "available", key: string, year: number,
 *   provisional: boolean, peopleAffected: number, giniChange: number,
 *   povertyChangePp: number, povertyChangePct: number}
 *   | {status: "unavailable", reason: string,
 *      availableSets: Array<Array<string>>}}
 */
export function combinedStats({ manifest, tablesByKey, selectedIds, year }) {
  const ids = uniqueIds(selectedIds);
  const unavailable = (reason) => ({
    status: "unavailable",
    reason,
    availableSets: availableCombinedSets(manifest),
  });
  if (ids.length === 0) return unavailable(REASONS.noSelection);
  const target = combinedEntryFor(manifest, ids);
  if (!target) {
    if (ids.length > 1) return unavailable(REASONS.noCombinedRun);
    return unavailable(
      measureEntry(manifest, ids[0])
        ? measureAvailability(manifest, ids[0]).reason
        : REASONS.notPublished,
    );
  }
  const statistics = {};
  for (const [name, column] of Object.entries(STATISTICS)) {
    const { value, reason } = readCell({
      tablesByKey,
      key: target.key,
      entry: target.entry,
      table: "metrics",
      column,
      year,
      match: () => true,
    });
    if (value === null) return unavailable(reason);
    statistics[name] = value;
  }
  return {
    status: "available",
    key: target.key,
    year,
    provisional: isProvisionalTarget(manifest, target),
    ...statistics,
  };
}

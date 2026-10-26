/**
 * Local rents for the Household impact form, for the household's Broad
 * Rental Market Area (BRMA) and the bedrooms its answers point to:
 *
 * - the average private rent (ONS, Price Index of Private Rents), the
 *   form's starting rent: by BRMA in Scotland and Northern Ireland, and in
 *   England and Wales the mean of the BRMA's local authorities' rents,
 *   weighted by their private renters in it;
 * - the Local Housing Allowance (LHA) rate for 2026-27, the "Use the local
 *   rate" button's rent: set in April 2024 at the 30th percentile of private
 *   rents in each area and frozen since (DWP, Universal Credit monthly
 *   rates).
 *
 * The table is localRents.json, written by scripts/build_local_rents.py
 * from policyengine-uk's own LHA tables and data_inputs/local_rents/; its
 * BRMA names are the ones the household API takes as `brma`.
 */
import table from "./localRents.json";

export const LOCAL_RENT_YEAR = table.year;

/** "September 2026": the month of the area's ONS average rent. */
export function marketMonth(inputs) {
  const month = table.areas[householdArea(inputs)]?.market_month;
  if (!month) return null;
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The API's area when none is sent: the region's BRMA with most renters. */
export const defaultArea = (region) => table.region_defaults[region] ?? null;

/** A BRMA's name, as DWP publishes it. */
export const areaLabel = (brma) => table.areas[brma]?.name ?? null;

/** The BRMAs in a region, by name, as select options. */
export function areasIn(region) {
  return Object.entries(table.areas)
    .filter(([, area]) => area.regions.includes(region))
    .map(([value, area]) => ({ value, label: area.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
}

/** The household's area: as chosen, if it lies in the region, else the region's default. */
export function householdArea(inputs) {
  const chosen = inputs.brma;
  if (chosen && table.areas[chosen]?.regions.includes(inputs.region)) return chosen;
  return defaultArea(inputs.region);
}

// Bedrooms by LHA category (A is a room in shared accommodation)
const BEDROOMS = [0, 1, 2, 3, 4];

/**
 * The LHA category for the bedrooms the household's answers point to,
 * simplified from the size criteria: one bedroom with no children (B), two
 * with one or two (C), three with three or four (D), four with five or
 * more (E), assuming children share as the rules allow. The shared
 * accommodation rate (A) is not used for the rent: a single person under 35
 * may rent a one-bedroom home, and the model caps their housing support at
 * the shared rate itself.
 */
export function lhaCategory(inputs, childrenCount) {
  if (childrenCount === 0) return 1;
  if (childrenCount <= 2) return 2;
  if (childrenCount <= 4) return 3;
  return 4;
}

/** The LHA rate a month, in whole pounds, for the household's area and size; null outside the table. */
export function localRent(inputs, childrenCount) {
  const area = table.areas[householdArea(inputs)];
  if (!area) return null;
  return Math.round(area.rates[lhaCategory(inputs, childrenCount)]);
}

/**
 * The average private rent a month (ONS), in whole pounds, for the
 * household's area and the same number of bedrooms; null outside the table.
 */
export function marketRent(inputs, childrenCount) {
  const area = table.areas[householdArea(inputs)];
  if (!area?.market) return null;
  return area.market[lhaCategory(inputs, childrenCount) - 1];
}

/** "a two-bedroom home", for the form's note. */
export function homeSize(inputs, childrenCount) {
  const bedrooms = BEDROOMS[lhaCategory(inputs, childrenCount)];
  return `a ${["", "one", "two", "three", "four"][bedrooms]}-bedroom home`;
}

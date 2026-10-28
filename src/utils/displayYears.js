/**
 * Which fiscal years the dashboard shows.
 *
 * The years come from the pipeline's own config (budget_years.json
 * policy_years), from FIRST_DISPLAY_YEAR on. A year the config lists but
 * the published files do not yet cover is shown as not yet published,
 * never as zero; it fills in once the pipeline is re-run. Moving the first
 * year is a one-line change here.
 *
 * 2026-27 (EARLY_YEAR) is shown as a normal year, in every chart, table and
 * the year pill, only while a selected policy moves revenue in it (e.g. the
 * Warm Home Discount top-up, winter 2026-27): yearsForSelection. Otherwise
 * the years start at 2027-28. No note says either way.
 */
import { createContext, useContext } from "react";
import budgetYears from "../uk_budget_data/budget_years.json";

/** The first fiscal year always shown on Population and Household calculator: 2027 is 2027-28. */
export const FIRST_DISPLAY_YEAR = 2027;

/** The year before it (2026-27): shown only when the selection has an effect in it. */
export const EARLY_YEAR = FIRST_DISPLAY_YEAR - 1;

const CONFIG_YEARS = budgetYears.policy_years.filter(
  (year) => year >= FIRST_DISPLAY_YEAR,
);

/** The last fiscal year shown: the config's last policy year. */
export const LAST_DISPLAY_YEAR = Math.max(...CONFIG_YEARS);

/** The year selected when none is given (2027-28): the header pill and every chart start here. */
export const DEFAULT_DISPLAY_YEAR = 2027;

/** Whether a year (number or numeric string) is one the dashboard shows. */
export const isDisplayYear = (year) => {
  const y = Number(year);
  return Number.isInteger(y) && y >= FIRST_DISPLAY_YEAR && y <= LAST_DISPLAY_YEAR;
};

/** Keep only the years the dashboard shows, in their order. */
export const displayYears = (years) => years.filter(isDisplayYear);

/** Every year shown, first to last. */
export const DISPLAY_YEARS = Object.freeze([...CONFIG_YEARS]);

/**
 * The years a reader can always choose (the year pill, Play, Household
 * impact): from 2027-28. App adds 2026-27 to the pill while the selection
 * has an effect in it (yearsForSelection); Household calculator's examples are
 * published from 2027-28 only.
 */
export const FIRST_SELECTABLE_YEAR = FIRST_DISPLAY_YEAR;

export const SELECTABLE_YEARS = Object.freeze(
  DISPLAY_YEARS.filter((year) => year >= FIRST_SELECTABLE_YEAR),
);

/** Whether a year can be chosen. */
export const isSelectableYear = (year) => SELECTABLE_YEARS.includes(Number(year));

/** A choosable year, or the default (e.g. an old link's 2026). */
export const selectableYearOr = (year, fallback = DEFAULT_DISPLAY_YEAR) =>
  isSelectableYear(year) ? Number(year) : fallback;

/**
 * The years shown for a selection: 2026-27 first when a selected policy's
 * published revenue figure for it is not zero, then 2027-28 on.
 *
 * @param {Array<Object>} budgetaryRows - Published revenue rows ({reform_id, year, value})
 * @param {string[]} selectedPolicies - The selected measure ids
 */
export function yearsForSelection(budgetaryRows, selectedPolicies) {
  if (!budgetYears.policy_years.includes(EARLY_YEAR)) return DISPLAY_YEARS;
  const early = (budgetaryRows ?? []).some(
    (row) =>
      selectedPolicies.includes(row.reform_id) &&
      Number(row.year) === EARLY_YEAR &&
      Math.abs(Number(row.value)) > 0.0005,
  );
  return early ? Object.freeze([EARLY_YEAR, ...DISPLAY_YEARS]) : DISPLAY_YEARS;
}

/** The years shown for the band's selection (App provides it; DISPLAY_YEARS without a provider). */
export const DisplayYearsContext = createContext(DISPLAY_YEARS);

/** The years shown for the band's selection. */
export const useDisplayYears = () => useContext(DisplayYearsContext);

/** Label for a year the config lists but the published files do not cover. */
export const NOT_YET_PUBLISHED = "Not yet published";

/**
 * Whether the published rows (each with a `year`) cover a year.
 */
export const isPublishedYear = (rows, year) =>
  Array.isArray(rows) && rows.some((row) => Number(row.year) === Number(year));

/** A shown year, or the default for anything else (e.g. an old link's 2026). */
export const displayYearOr = (year, fallback = DEFAULT_DISPLAY_YEAR) =>
  isDisplayYear(year) ? Number(year) : fallback;

/** Keep only the rows (with a `year` field) for years the dashboard shows. */
export const displayRows = (rows) => rows.filter((row) => isDisplayYear(row.year));

/** A fiscal year's label: 2027 is "2027-28". */
export const yearLabel = (year) => `${year}-${(Number(year) + 1).toString().slice(-2)}`;

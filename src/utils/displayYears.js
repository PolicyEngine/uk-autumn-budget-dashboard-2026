/**
 * Which fiscal years the dashboard shows.
 *
 * The years come from the pipeline's own config (budget_years.json
 * policy_years), from FIRST_DISPLAY_YEAR on. A year the config lists but
 * the published files do not yet cover is shown as not yet published,
 * never as zero; it fills in once the pipeline is re-run. Moving the first
 * year is a one-line change here.
 */
import budgetYears from "../uk_budget_data/budget_years.json";

/** The first fiscal year shown: 2026 is 2026-27 (the Warm Home Discount top-up's winter). */
export const FIRST_DISPLAY_YEAR = 2026;

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

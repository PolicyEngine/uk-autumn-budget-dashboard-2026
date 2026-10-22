/**
 * Which fiscal years the dashboard shows.
 *
 * The data files and pipeline carry 2026-27 to 2030-31; the dashboard
 * starts at 2027-28. Every year list in the UI goes through this filter, so
 * moving the first year back is a one-line change here.
 */

/** The first fiscal year shown: 2027 is 2027-28. */
export const FIRST_DISPLAY_YEAR = 2027;

/** The last fiscal year in the data: 2030 is 2030-31. */
export const LAST_DISPLAY_YEAR = 2030;

/** The year selected when none is given (2029-30). */
export const DEFAULT_DISPLAY_YEAR = 2029;

/** Whether a year (number or numeric string) is one the dashboard shows. */
export const isDisplayYear = (year) => {
  const y = Number(year);
  return Number.isInteger(y) && y >= FIRST_DISPLAY_YEAR && y <= LAST_DISPLAY_YEAR;
};

/** Keep only the years the dashboard shows, in their order. */
export const displayYears = (years) => years.filter(isDisplayYear);

/** Every year shown, first to last. */
export const DISPLAY_YEARS = Object.freeze(
  Array.from(
    { length: LAST_DISPLAY_YEAR - FIRST_DISPLAY_YEAR + 1 },
    (_, index) => FIRST_DISPLAY_YEAR + index,
  ),
);

/** A shown year, or the default for anything else (e.g. an old link's 2026). */
export const displayYearOr = (year, fallback = DEFAULT_DISPLAY_YEAR) =>
  isDisplayYear(year) ? Number(year) : fallback;

/** Keep only the rows (with a `year` field) for years the dashboard shows. */
export const displayRows = (rows) => rows.filter((row) => isDisplayYear(row.year));

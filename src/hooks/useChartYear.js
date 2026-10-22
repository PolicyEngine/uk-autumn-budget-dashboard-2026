import { useState } from "react";
import { displayYearOr } from "../utils/displayYears";

/**
 * A chart's own year, chosen with the YearSlider in its controls row.
 *
 * It starts at `initialYear` when that is a year the dashboard shows, and
 * at the default year (2029-30) otherwise. Returns `[year, setYear]`; the
 * setter takes a value or an updater, as YearSlider's play mode needs.
 */
export default function useChartYear(initialYear) {
  return useState(() => displayYearOr(initialYear));
}
